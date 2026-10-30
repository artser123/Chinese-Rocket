/* Chinese Rocket service worker — PWA offline support
   Strategy: precache the app shell, stale-while-revalidate for everything
   else cacheable (audio clips, whisper model, CDN libs, fonts). */
const CACHE = "cr-v131";

const CORE = [
  "./",
  "./index.html",
  "./style.css",
  "./js/01-state.js",
  "./js/02-audio.js",
  "./js/03-helpers.js",
  "./js/04-quiz.js",
  "./js/05-meteor.js",
  "./js/06-zombie.js",
  "./js/07-menu.js",
  "./js/08-dict.js",
  "./js/09-speak.js",
  "./js/10-listen.js",
  "./js/11-copy.js",
  "./js/12-trace.js",
  "./js/13-podcast.js",
  "./js/14-reader.js",
  "./js/15-vocaboverview.js",
  "./js/16-missions.js",
  "./manifest.json",
  "./icons/modes/dict.webp",
  "./icons/modes/meteor.webp",
  "./icons/modes/zombie.webp",
  "./icons/modes/vocab.webp",
  "./icons/modes/vocaboverview.webp",
  "./icons/modes/sentence.webp",
  "./icons/modes/sentencequiz.webp",
  "./icons/modes/speak.webp",
  "./icons/modes/fillblank.webp",
  "./icons/modes/bomb.webp",
  "./icons/modes/matching.webp",
  "./icons/modes/listen.webp",
  "./icons/modes/podcast.webp",
  "./icons/modes/reader.webp",
  "./icons/modes/copy.webp",
  "./icons/modes/trace.webp",
  "./fonts/kanit-thai-700-normal.woff2",
  "./fonts/kanit-latin-700-normal.woff2",
  "./fonts/kanit-thai-800-italic.woff2",
  "./fonts/kanit-latin-800-italic.woff2",
  "./fonts/kanit-thai-900-italic.woff2",
  "./fonts/kanit-latin-900-italic.woff2",
  "./data/vocab.js",
  "./data/vocab_extra.js",
  "./data/sentences.js",
  "./data/sentences_extra.js",
  "./data/sentences_hsk69.js",
  "./data/vocab_it.js",
  "./data/sentences_it.js",
  "./data/vocab_hotel.js",
  "./data/sentences_hotel.js",
  "./data/vocab_factory.js",
  "./data/sentences_factory.js",
  "./data/vocab_trade.js",
  "./data/sentences_trade.js",
  "./data/vocab_office.js",
  "./data/sentences_office.js",
  "./data/vocab_food.js",
  "./data/sentences_food.js",
  "./data/vocab_media.js",
  "./data/sentences_media.js",
  "./data/vocab_business.js",
  "./data/sentences_business.js",
  "./data/vocab_phone.js",
  "./data/sentences_phone.js",
  "./data/vocab_gym.js",
  "./data/sentences_gym.js",
  "./data/vocab_car.js",
  "./data/sentences_car.js",
  "./data/vocab_reading.js",
  "./data/flashcards.js",
  "./js/17-flashcards.js",
  "./js/18-flashview.js",
  "./icons/modes/flashcards.webp",
  "./icons/modes/flashview.webp",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/app-logo.webp",
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
