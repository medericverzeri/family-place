const CACHE = 'maison-v1';
const SHELL = [
  './', './index.html', './manifest.json',
  './css/style.css',
  './js/config.js', './js/util.js', './js/api.js', './js/auth.js',
  './js/profile.js', './js/chat.js', './js/map.js', './js/calls.js', './js/admin.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Coquille de l'app : réseau d'abord, cache en secours (marche hors-ligne, à jour dès que possible).
// Données (Supabase, cartes, médias) : toujours en direct, jamais mises en cache ici.
self.addEventListener('fetch', function (e) {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // laisse passer Supabase, les tuiles de carte, les polices
  if (e.request.method !== 'GET') return;

  e.respondWith(
    fetch(e.request).then(function (res) {
      const copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(e.request, copy); });
      return res;
    }).catch(function () {
      return caches.match(e.request).then(function (r) { return r || caches.match('./index.html'); });
    })
  );
});
