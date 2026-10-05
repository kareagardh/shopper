// Service worker: sparar kundappen och utgångsvyn i telefonen så att de öppnas utan nät.
// Höj VERSION vid varje ändring av filerna nedan (även config.js), annars ser telefonerna den gamla versionen.
const VERSION = 'rbl-2026-10-05-1';

// Alla sökvägar är relativa till appens rot (fungerar både på egen domän och på github.io/<repo>/)
const BASE = self.registration.scope;
const SHELL = [
  '', 'index.html', 'config.js', 'css/app.css', 'js/common.js', 'js/kund.js',
  'vendor/qrcode-generator.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png',
  'utgang/', 'utgang/index.html', 'js/utgang.js', 'vendor/html5-qrcode.min.js'
].map(p => new URL(p, BASE).href);

self.addEventListener('install', e => {
  // cache: 'reload' hoppar över webbläsarens HTTP-cache (GitHub Pages cachar filer i 10 minuter)
  e.waitUntil(caches.open(VERSION)
    .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Sparade filer först, nätet bara om filen saknas. Anrop till databasen går aldrig via cachen.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(BASE)) return;
  const rel = req.url.slice(BASE.length);
  if (rel.startsWith('admin')) return; // admin kräver alltid nät
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => req.mode === 'navigate'
      ? caches.match(new URL(rel.startsWith('utgang') ? 'utgang/' : '', BASE).href)
      : Response.error()))
  );
});
