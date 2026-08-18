const SHELL = "gre-desk-shell-v3";
const catalogName = request => `gre-desk-catalog-${new URL(request.url).pathname}`;
self.addEventListener("install", event => event.waitUntil(caches.open(SHELL).then(cache => cache.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png"])).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", event => {
  const { request } = event; const url = new URL(request.url);
  if (request.method !== "GET" || url.pathname.startsWith("/api/media/")) return;
  if (url.pathname.startsWith("/api/catalog/")) { event.respondWith(caches.open(catalogName(request)).then(async cache => { try { const network = await fetch(request); if (network.ok) cache.put(request, network.clone()); return network; } catch { const hit = await cache.match(request); if (hit) return hit; throw new Error("Catalog unavailable offline"); } })); return; }
  if (url.origin === location.origin && request.headers.get("accept")?.includes("text/html")) event.respondWith(fetch(request).catch(() => caches.match("/")));
});
