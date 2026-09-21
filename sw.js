/* Chinese Rocket service worker — PWA offline support
   Strategy: precache the app shell, stale-while-revalidate for everything
   else cacheable (audio clips, whisper model, CDN libs, fonts). */
const CACHE = "cr-v15";

const CORE = [
  "./",
  "./index.html",
  "./style.css",
  "./game.js",
  "./manifest.json",
  "./data/vocab.js",
  "./data/vocab_extra.js",
  "./data/sentences.js",
  "./data/sentences_extra.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

// CDN hosts the game depends on (fonts, hanzi-writer, hanzilookup, transformers.js)
const CDN_HOSTS = new Set([
  "cdn.jsdelivr.net",
  "fonts.googleapis.com",
  "fonts.gstatic.com",
]);

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin && !CDN_HOSTS.has(url.hostname)) return;

  e.respondWith(
    caches.match(req).then((hit) => {
      const fetched = fetch(req)
        .then((res) => {
          // res.ok for CORS responses, status 0 for opaque cross-origin
          if (res.ok || res.status === 0) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit); // offline: serve cache if we have it
      return hit || fetched;
    })
  );
});
