// SNS Job Pricing Tool — Service Worker
// Bump CACHE_VERSION whenever you deploy an update
const CACHE_VERSION = 'sns-pricing-v4';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

// ── Install: cache all assets ─────────────────────────────────────────────────
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: delete old caches ───────────────────────────────────────────────
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: cache local app assets only — never cache API calls ───────────────
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  // Never intercept Supabase API calls — they must always hit the live database.
  // Caching these was causing stale data to be served instead of cloud data.
  const url = new URL(e.request.url);
  if (url.hostname.endsWith('supabase.co')) return;
  e.respondWith(
    caches.open(CACHE_VERSION).then(cache =>
      cache.match(e.request).then(cached => {
        const network = fetch(e.request).then(res => {
          if (res.ok) cache.put(e.request, res.clone());
          return res;
        }).catch(() => null);
        return cached || network;
      })
    )
  );
});

// ── Notify clients when a new version is waiting ──────────────────────────────
self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
});
