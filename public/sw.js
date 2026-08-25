/* Smart Chat service worker: cache wechat-emoji images locally so they
   don't re-download on every page open. Only intercepts /wechat-emoji/* GETs;
   all other requests pass through to the network untouched. */
const EMOJI_CACHE = "wechat-emoji-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k.startsWith("wechat-emoji-") && k !== EMOJI_CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith("/wechat-emoji/")) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(EMOJI_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        if (resp && resp.ok) cache.put(req, resp.clone());
        return resp;
      } catch {
        return cached || Response.error();
      }
    })(),
  );
});
