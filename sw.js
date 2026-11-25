// Service worker de La Chavitera. VERSION est remplacée à chaque déploiement (workflow GitHub).
const VERSION = '__BUILD__';
const SHELL = 'lc-shell-' + VERSION, DATA = 'lc-data';
const SHELL_FILES = ['./', 'index.html', 'css/app.css', 'js/app.js', 'js/store.js', 'js/data.js', 'js/reco.js', 'js/icons.js',
  'js/version.js', 'js/haptic.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('lc-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms)); }

// réseau d'abord (mises à jour immédiates), cache si hors ligne
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([fetch(req, { cache: 'no-cache' }), timeout(4000)]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return (await cache.match(req, { ignoreSearch: req.mode === 'navigate' })) || (await cache.match('index.html')) || Response.error();
  }
}
// données versionnées (?v=...) : cache d'abord, on purge les anciennes versions
async function dataCacheFirst(req) {
  const cache = await caches.open(DATA);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) {
    const v = new URL(req.url).searchParams.get('v');
    cache.put(req, res.clone());
    if (v) cache.keys().then(ks => ks.forEach(k => { const kv = new URL(k.url).searchParams.get('v'); if (kv && kv !== v) cache.delete(k); }));
  }
  return res;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (url.pathname.includes('/data/') && url.searchParams.has('v')) return e.respondWith(dataCacheFirst(req));
    return e.respondWith(networkFirst(req, url.pathname.includes('/data/') ? DATA : SHELL));
  }
  if (url.host.includes('fonts.g') || url.host.includes('themealdb.com')) {
    e.respondWith(caches.open(DATA).then(async c => (await c.match(req)) || fetch(req).then(r => { c.put(req, r.clone()); return r; })));
  }
});
