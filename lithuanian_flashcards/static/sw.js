const CACHE_NAME = "lt-trainer-static-v1";

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
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(assetUrls())));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
    ),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }

      return fetch(event.request).then((response) => {
        const requestUrl = new URL(event.request.url);
        if (requestUrl.origin === self.location.origin) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
        }
        return response;
      });
    }),
  );
});
