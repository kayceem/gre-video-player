/* GRE Study Desk service worker — offline-first app shell + catalogs.
 * Strategies:
 *  - App shell / navigations: network-first, fallback to cache, then /offline.html
 *  - Same-origin static assets (js/css/fonts/img/json under /data,/icons,/assets): stale-while-revalidate
 *  - /api/catalog + /data/*.json: stale-while-revalidate (IndexedDB in app is source of truth for full offline)
 *  - /api/media (video): complete lessons saved from Downloads are served with byte ranges offline
 *  - Mutations (POST/PUT/DELETE): never cache; app queues them in IndexedDB
 */
const VERSION = "gre-desk-v5";
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const DATA = `${VERSION}-data`;
const MEDIA = "gre-desk-media-v1";
const PRECACHE = ["/", "/offline.html", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/icons/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== MEDIA && !k.startsWith(VERSION)).map((k) => caches.delete(k))
      );
      await self.clients.claim();
      if ("navigationPreload" in self.registration) {
        try { await self.registration.navigationPreload.enable(); } catch {}
      }
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

const isNavigation = (request) =>
  request.mode === "navigate" ||
  (request.method === "GET" && request.headers.get("accept")?.includes("text/html"));

async function networkFirstNavigation(event) {
  const cache = await caches.open(SHELL);
  try {
    const preload = await event.preloadResponse;
    if (preload) {
      cache.put(event.request, preload.clone()).catch(() => {});
      return preload;
    }
    const network = await fetch(event.request);
    if (network.ok) cache.put(event.request, network.clone()).catch(() => {});
    return network;
  } catch {
    const hit = await cache.match(event.request).catch(() => null)
      || await cache.match("/").catch(() => null);
    return hit || caches.match("/offline.html");
  }
}

async function staleWhileRevalidate(event, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(event.request).catch(() => null);
  const network = fetch(event.request).then((res) => {
    if (res.ok) cache.put(event.request, res.clone()).catch(() => {});
    return res;
  }).catch(() => null);
  return hit || network || Promise.reject(new Error("offline"));
}

async function cachedMedia(request) {
  const cache = await caches.open(MEDIA);
  const cached = await cache.match(request.url);
  if (!cached) return fetch(request);
  const range = request.headers.get("range");
  if (!range) return cached;
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) return new Response(null, { status: 416, headers: { "Content-Range": "bytes */*" } });
  const blob = await cached.blob();
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), blob.size - 1) : blob.size - 1;
  if (start >= blob.size || end < start) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${blob.size}` } });
  }
  return new Response(blob.slice(start, end + 1, blob.type), {
    status: 206,
    headers: {
      "Content-Type": blob.type || "video/mp4",
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes ${start}-${end}/${blob.size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET") return;
  // Downloaded complete media files need range-aware responses for video seeking.
  if (url.pathname.startsWith("/api/media/")) {
    event.respondWith(cachedMedia(request));
    return;
  }
  if (url.pathname.startsWith("/api/audio-proxy")) return;

  // Navigations: network-first with offline fallback.
  if (isNavigation(request) && url.origin === location.origin) {
    event.respondWith(networkFirstNavigation(event));
    return;
  }

  if (url.origin !== location.origin) {
    // Third-party (fonts/CDN): cache-first,  no failure when offline.
    if (url.hostname.includes("fonts.g")) {
      event.respondWith(
        caches.open(STATIC).then(async (cache) => {
          const hit = await cache.match(request).catch(() => null);
          if (hit) return hit;
          try {
            const res = await fetch(request);
            if (res.ok) cache.put(request, res.clone()).catch(() => {});
            return res;
          } catch { return hit || Response.error(); }
        })
      );
    }
    return;
  }

  // Catalog JSON + memorize data: SWR so offline still works.
  if (url.pathname.startsWith("/api/catalog/") || url.pathname.startsWith("/data/")) {
    event.respondWith(
      staleWhileRevalidate(event, DATA).catch(() => caches.match("/offline.html"))
    );
    return;
  }

  // App static assets + icons + manifest: SWR.
  if (
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    /\.(js|css|woff2?|ttf|png|svg|ico|json|webmanifest)$/.test(url.pathname)
  ) {
    event.respondWith(staleWhileRevalidate(event, STATIC));
    return;
  }
});
