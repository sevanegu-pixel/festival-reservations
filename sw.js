// Appli Réservations du festival : rien n'est mis en cache, tout passe par le réseau (le lien personnel reste dans l'appareil).
// Les pages (index.html, gestion.html) sont toujours relues sur le réseau : une nouvelle version de l'écran
// s'affiche dès la réouverture, sans vider le cache du téléphone.
self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (e) { e.waitUntil(self.clients.claim()); });
self.addEventListener("fetch", function (e) {
  var r = e.request;
  if (r.method !== "GET") return;
  var page = r.mode === "navigate" || /\.html(\?|$)/.test(r.url);
  if (!page || new URL(r.url).origin !== self.location.origin) return;
  e.respondWith(fetch(r, { cache: "no-store" }).catch(function () { return fetch(r); }));
});
