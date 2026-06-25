# Job Pricing Tool — Web App Framework

> Based on analysis of `Job Pricing.xlsx` (3 sheets: **JOB PRICING**, **SNS PN LIST**, **Shopping List**)

---

## 1. What the Excel File Tells Us

### Sheet 1 — JOB PRICING (the calculator)

The main pricing sheet has two zones:

**Settings panel (rows 1–15) — global job parameters:**

| Setting | Default | Role |
|---|---|---|
| Install Discount | 0 | Dollar discount applied to install costs |
| Hardware Buy Price Markup | 15% | Margin added on top of buy price |
| Risk Markup | 4% | Applied on top of hardware + install subtotal |
| Travel Time (hrs) | 0 | Billed at $75/hr |
| Contractor Costs (incl GST) | — | Manual entry |

**Summary block outputs:**
- SNS Quote
- SNS Sundries
- Total Before Discounts
- Total Quote (after discount)
- GST (10%)
- **Total incl GST**
- Hardware Costs
- Margin (labour + profit)
- Labour Time (hours)

**Line-item table (row 18 headers, rows 19+ data) — 19 columns:**

| # | Column | Type | Notes |
|---|---|---|---|
| A | SNS Part Number | Text/ID | Primary key, looked up against master pricing file |
| B | Item Description | Text | Auto-filled via VLOOKUP from Pricing sheet |
| C | RRP | Currency | Auto-filled |
| D | Trade Price | Currency | Auto-filled |
| E | Price Checked Date | Date | Auto-filled |
| F | Buy Price | Currency | **Editable** — best supplier price entered here |
| G | QTY | Number | **Editable** |
| H | Mark up % | % | Inherits global setting (B2) |
| I | Including Hardware Markup | Currency | F × (1 + H) — calculated |
| J | Install Cost (qty 1) | Currency | Auto-filled from Pricing sheet |
| K | Hardware w/ markup + install (qty 1) | Currency | I + J — calculated |
| L | Total Buy Price | Currency | F × G — calculated |
| M | Total Hardware Costs with Markup | Currency | I × G — calculated |
| N | Total Hardware w/ markup + install | Currency | K × G — calculated |
| O | Total Hardware w/ markup + install + Risk | Currency | N × (1 + Risk%) — calculated |
| P | Total Before Discounts | Currency | = O (per row) — calculated |
| Q | Install Discount | Currency | J × G × install discount % — calculated |
| R | Install Time (qty 1) | Minutes | Auto-filled from Pricing sheet |
| S | Total Install Time | Minutes | R × G — calculated |

---

### Sheet 2 — SNS PN LIST
A master list of all SNS Part Numbers (1000+ entries). Used as the autocomplete / validation source for part number lookups.

### Sheet 3 — Shopping List
A procurement checklist generated from a job:

| Column | Purpose |
|---|---|
| SNS Part Number | Which part |
| QTY Required | How many needed for job |
| QTY In Stock | Current stock on hand |
| QTY Purchase | Net qty to buy (Required − In Stock) |
| Supplier | Who to buy from |
| Price | Best price found |
| Remarks | Notes (e.g. "kit saves $60") |

---

## 2. Application Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Job Pricing Tool                     │
├──────────────┬──────────────────┬───────────────────────┤
│  Parts DB    │   Job Builder    │   Price Checker       │
│  (Module 1)  │   (Module 2)     │   (Module 3)          │
│              │                  │                       │
│ - Import     │ - New job        │ - Select items        │
│   from Excel │ - Add parts      │ - Search suppliers    │
│ - Add parts  │ - Set qty        │ - Compare prices      │
│ - Edit parts │ - Set markups    │ - Apply best price    │
│ - Search/    │ - Live totals    │                       │
│   filter     │ - Shopping list  │                       │
└──────────────┴──────────────────┴───────────────────────┘
                        │
                        ▼
              ┌─────────────────┐
              │  Quote Summary  │
              │  (Module 4)     │
              │                 │
              │ - Total excl GST│
              │ - GST           │
              │ - Total incl GST│
              │ - Margin        │
              │ - Labour hrs    │
              │ - Export        │
              └─────────────────┘
```

---

## 3. Database Schema

### Table: `parts` (Master Parts List)
Imported from SNS PN LIST + Pricing sheet data.

```sql
CREATE TABLE parts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sns_part_number TEXT UNIQUE NOT NULL,   -- e.g. "DHI-NVR4108HS-8P-AI/ANZ"
  description     TEXT,
  rrp             DECIMAL(10,2),
  trade_price     DECIMAL(10,2),
  buy_price       DECIMAL(10,2),          -- last known best price
  install_cost    DECIMAL(10,2),          -- cost to install one unit
  install_time_min INTEGER,               -- install time in minutes
  price_checked_date DATE,
  category        TEXT,                   -- e.g. "Camera", "NVR", "HDD", "Labour"
  supplier_urls   TEXT,                   -- JSON array of supplier search URLs
  created_at      DATETIME DEFAULT NOW(),
  updated_at      DATETIME DEFAULT NOW()
);
```

### Table: `jobs`
One record per quote/job.

```sql
CREATE TABLE jobs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  job_name              TEXT NOT NULL,
  client_name           TEXT,
  job_date              DATE,
  install_discount      DECIMAL(10,2) DEFAULT 0,
  hardware_markup_pct   DECIMAL(5,4)  DEFAULT 0.15,
  risk_markup_pct       DECIMAL(5,4)  DEFAULT 0.04,
  travel_hours          DECIMAL(5,2)  DEFAULT 0,
  contractor_costs      DECIMAL(10,2) DEFAULT 0,
  notes                 TEXT,
  status                TEXT DEFAULT 'draft',  -- draft | quoted | won | lost
  created_at            DATETIME DEFAULT NOW(),
  updated_at            DATETIME DEFAULT NOW()
);
```

### Table: `job_lines`
One record per part/line in a job.

```sql
CREATE TABLE job_lines (
  id                        INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id                    INTEGER REFERENCES jobs(id),
  sns_part_number           TEXT REFERENCES parts(sns_part_number),
  qty                       INTEGER DEFAULT 1,
  buy_price_override        DECIMAL(10,2),  -- NULL = use parts.buy_price
  markup_pct_override       DECIMAL(5,4),   -- NULL = use job.hardware_markup_pct
  remarks                   TEXT,
  -- Calculated fields (stored for performance, recalculated on save)
  unit_with_markup          DECIMAL(10,2),
  total_buy_price           DECIMAL(10,2),
  total_with_markup         DECIMAL(10,2),
  total_with_markup_install DECIMAL(10,2),
  total_with_risk           DECIMAL(10,2),
  total_before_discounts    DECIMAL(10,2),
  install_discount_amount   DECIMAL(10,2),
  total_install_time_min    INTEGER,
  sort_order                INTEGER DEFAULT 0
);
```

### Table: `price_checks`
History of supplier price lookups.

```sql
CREATE TABLE price_checks (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sns_part_number TEXT REFERENCES parts(sns_part_number),
  supplier_name   TEXT,      -- e.g. "Dahua AU", "Seadan", "Suretek"
  supplier_url    TEXT,
  price           DECIMAL(10,2),
  checked_at      DATETIME DEFAULT NOW(),
  selected        BOOLEAN DEFAULT FALSE
);
```

---

## 4. Calculation Logic

All calculations mirror the Excel formulas exactly:

```
buy_price           = parts.buy_price (or override)
markup_pct          = job.hardware_markup_pct (or override)
risk_pct            = job.risk_markup_pct
install_discount_pct = job.install_discount / 100

-- Per line item:
unit_with_markup          = buy_price × (1 + markup_pct)
total_buy_price           = buy_price × qty
total_with_markup         = unit_with_markup × qty
total_with_markup_install = (unit_with_markup + install_cost) × qty
total_with_risk           = total_with_markup_install × (1 + risk_pct)
total_before_discounts    = total_with_risk
install_discount_amount   = install_cost × qty × install_discount_pct
total_install_time_min    = install_time_min × qty

-- Job totals:
sns_quote             = SUM(total_before_discounts)
sns_sundries          = travel_hours × 75
total_before_discount = sns_quote + sns_sundries + contractor_costs
install_discount_total = SUM(install_discount_amount)
total_quote           = total_before_discount - install_discount_total
gst                   = total_quote × 0.10
total_incl_gst        = total_quote + gst
hardware_costs        = SUM(total_buy_price)
margin                = total_quote - hardware_costs - contractor_costs
labour_hours          = SUM(total_install_time_min) / 60
```

---

## 5. UI Layout & Screens

### Screen 1 — Parts Database
- **Import button**: Upload `Job Pricing.xlsx` → parses SNS PN LIST + populates `parts` table
- **Search bar**: Live search by part number or description
- **Parts table**: Sortable, filterable grid with all columns
- **Add Part button**: Opens modal form to enter a new part manually
- **Edit/Delete** actions per row
- **Export to Excel** button

### Screen 2 — Job Builder
- **Job header form**: Job name, client, date, and the 4 global settings (markup %, risk %, travel hrs, contractor costs, install discount)
- **Line items table**: 
  - Search/add part by SNS part number or description (autocomplete from Parts DB)
  - Editable QTY and Buy Price per line
  - All calculated columns shown (read-only, auto-updated)
  - Drag to reorder rows
- **Live Summary panel** (sidebar or bottom bar):
  - Hardware Costs
  - SNS Quote
  - Sundries
  - Contractor Costs
  - Subtotal
  - Install Discount
  - Total Quote (excl GST)
  - GST
  - **Total incl GST** (large, prominent)
  - Margin $
  - Labour Hours

### Screen 3 — Price Checker
- Select one or more parts from the current job (checkboxes)
- For each selected part, display:
  - Current buy price on file
  - **"Check Prices" button** → opens supplier search links in new tabs (or fetches via Claude)
  - Manual price entry fields per supplier (Dahua AU, Seadan, Suretek, etc.)
  - **Best Price** highlighted automatically
  - **"Apply Best Price"** button → updates the line item buy price
- Price check history log showing date, supplier, price

### Screen 4 — Shopping List
- Auto-generated from current job lines
- Columns: Part Number, Description, QTY Required, QTY In Stock (editable), QTY to Purchase, Supplier, Price, Remarks
- Print / Export to Excel

### Screen 5 — Quote Summary / Export
- Clean printable quote view
- PDF export
- Excel export (matching original format)

---

## 6. Supplier Price Check Strategy

Since suppliers don't have public APIs, the price check feature works in one of two ways:

### Option A — Manual Entry with Quick Links (MVP)
For each part, pre-configure search URLs for known suppliers:

```javascript
const SUPPLIERS = [
  {
    name: "Dahua AU",
    searchUrl: (partNo) => `https://www.dahuasecurity.com/au/search?q=${encodeURIComponent(partNo)}`
  },
  {
    name: "Seadan Security",
    searchUrl: (partNo) => `https://seadan.com.au/catalogsearch/result/?q=${encodeURIComponent(partNo)}`
  },
  {
    name: "Suretek",
    searchUrl: (partNo) => `https://www.suretek.com.au/search?q=${encodeURIComponent(partNo)}`
  },
  {
    name: "Anixter / Wesco",
    searchUrl: (partNo) => `https://www.anixter.com/search#q=${encodeURIComponent(partNo)}`
  }
];
```

The tool opens these links in new browser tabs, and the user manually enters the best price found back into the tool.

### Option B — Claude-Assisted Price Lookup (Advanced)
Use Claude to browse supplier websites and extract prices automatically. This would:
1. Take the part number
2. Navigate to each supplier URL
3. Extract the current price
4. Return results for comparison

### Recommended approach: Option A for v1, Option B as an upgrade path.

---

## 7. Technology Recommendations

### Option A — Single-file HTML Tool (Simplest, no server needed)
- Pure HTML + JavaScript + CSS in one `.html` file
- Uses `localStorage` or `IndexedDB` for data persistence
- Import Excel via SheetJS library
- No installation, runs in any browser
- **Best for**: Quick win, personal use, offline use

### Option B — React Web App (More powerful)
- React + Tailwind CSS for UI
- SQLite (via sql.js in browser, or better: a small Node/Python backend)
- SheetJS for Excel import/export
- **Best for**: Team use, multiple jobs, richer features

### Option C — Electron Desktop App
- Same as Option B but packaged as a Windows/Mac app
- Data stored locally in SQLite
- **Best for**: Offline-first, no web hosting needed

### **Recommended**: Start with Option A (single HTML file) to validate the workflow, then graduate to Option B.

---

## 8. Build Phases

### Phase 1 — Parts Database (MVP)
- [ ] Single HTML file with SheetJS
- [ ] Import `Job Pricing.xlsx` → extract SNS PN LIST and populate in-memory database
- [ ] Display searchable, sortable parts table
- [ ] Add / Edit / Delete parts manually
- [ ] Save to `localStorage`

### Phase 2 — Job Builder & Calculator
- [ ] Job settings form (markup %, risk %, travel, contractor costs)
- [ ] Line item entry with autocomplete from Parts DB
- [ ] Live calculation engine (mirrors Excel formulas exactly)
- [ ] Live summary panel
- [ ] Save/load multiple jobs

### Phase 3 — Price Checker
- [ ] Select parts for price checking
- [ ] Quick links to supplier search pages
- [ ] Manual price entry and comparison table
- [ ] "Apply Best Price" flow
- [ ] Price check history

### Phase 4 — Shopping List & Export
- [ ] Auto-generate shopping list from job
- [ ] QTY in stock tracking
- [ ] Export to Excel (matching original format)
- [ ] Print-friendly quote view
- [ ] PDF export

---

## 9. File Structure (for HTML single-file approach)

```
Job Pricing Tool/
├── Job Pricing.xlsx          ← Source data (existing)
├── FRAMEWORK.md              ← This document
├── job-pricing-tool.html     ← The app (single file, all-in-one)
└── exports/
    └── (generated Excel/PDF exports go here)
```

---

## 10. Key Data from the Existing Excel

Sample parts already in the system (from Job Pricing sheet rows 19–24):

| SNS Part Number | Buy Price | QTY | Notes |
|---|---|---|---|
| DHI-NVR4108HS-8P-AI/ANZ | $264.00 | 1 | 8-ch NVR |
| 4TBHDDSEAGATE | $220.00 | 1 | 4TB HDD |
| DH-IPC-HDW3649H-AS-PV-ANZ-S2 | $268.52 | 2 | Camera |
| DH-IPC-HDW3667EM-S-IL-ANZ | $147.40 | 2 | Camera |
| DH-PFA130-E | $19.06 | 2 | Mount |
| SNSLABOUR | $100.00 | 2 | Labour item |

Global settings in this job: Hardware Markup = 15%, Risk Markup = 4%

---

*Framework version 1.0 — Ready to build Phase 1*
