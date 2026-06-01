const CACHE_NAME = "lt-trainer-static-v2";

function assetUrls() {
  return [
    new URL("./", self.registration.scope).toString(),
    new URL("./index.html", self.registration.scope).toString(),
    new URL("./styles.css", self.registration.scope).toString(),
    new URL("./app.js", self.registration.scope).toString(),
    new URL("./manifest.webmanifest", self.registration.scope).toString(),
  ];
}

self.addEventListener("install", (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(assetUrls())));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      ),
    ]),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  const requestUrl = new URL(event.request.url);
  const isSameOrigin = requestUrl.origin === self.location.origin;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (isSameOrigin) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
