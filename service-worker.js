// The build script fills in the cache name and the file list automatically on every build,
// so you never bump a version by hand: new build = new cache = phones update.
const CACHE = 'ledger-0e9435805b';
const FILES = [
  "./",
  "./app.css",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./index.html",
  "./js/core/analytics.js",
  "./js/core/dates.js",
  "./js/core/exchange.js",
  "./js/core/ids.js",
  "./js/core/money.js",
  "./js/core/orders.js",
  "./js/core/pin.js",
  "./js/core/reports.js",
  "./js/core/timers.js",
  "./js/data/db.js",
  "./js/data/store.js",
  "./js/main.js",
  "./js/ui/actions.js",
  "./js/ui/books.js",
  "./js/ui/bus.js",
  "./js/ui/components.js",
  "./js/ui/counter.js",
  "./js/ui/customers.js",
  "./js/ui/dom.js",
  "./js/ui/endday.js",
  "./js/ui/expenses.js",
  "./js/ui/files.js",
  "./js/ui/insights.js",
  "./js/ui/lines.js",
  "./js/ui/lock.js",
  "./js/ui/orderTable.js",
  "./js/ui/orders.js",
  "./js/ui/settings.js",
  "./js/ui/view.js",
  "./manifest.json"
];

self.addEventListener('install', (e) => {
  // Cache every file or none: a half-cached app is worse than the old working one.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('ledger-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// The page asks to update only when the person taps "Update now" (never mid-order).
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cached = await caches.match(req, { ignoreSearch: true });
    if (cached) return cached;
    try { return await fetch(req); }
    catch (_) {
      if (req.mode === 'navigate') return (await caches.match('./index.html')) || Response.error();
      return Response.error();
    }
  })());
});
