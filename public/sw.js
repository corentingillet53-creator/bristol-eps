/* Service worker de Bristol EPS : l'application reste utilisable hors ligne.
   - la page : réseau d'abord (pour recevoir les mises à jour), copie en cache si le réseau manque ;
   - les polices Google : copie en cache, rafraîchie en arrière-plan ;
   - les icônes et le manifeste : cache d'abord ;
   - /api/* : jamais mis en cache (comptes, progression, retour de Claude). */
const PAGE = "bristol-page-v1", STATIC = "bristol-static-v1", FONTS = "bristol-fonts-v1";  // v2 : rappels par notification
const KEEP = [PAGE, STATIC, FONTS];
const PRECACHE = ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/favicon-32.png"];

self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const s = await caches.open(STATIC); await s.addAll(PRECACHE);
    try { const r = await fetch("/", { cache: "no-store" }); if (r.ok) await (await caches.open(PAGE)).put("/", r); } catch (err) {}
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!KEEP.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

function withTimeout(p, ms){ return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]); }

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (same && url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate" && same) {
    e.respondWith((async () => {
      const cache = await caches.open(PAGE);
      try {
        const r = await withTimeout(fetch(req), 5000);
        if (r.ok && r.type === "basic") cache.put("/", r.clone());
        return r;
      } catch (err) {
        return (await cache.match("/")) || new Response("Hors ligne : ouvre Bristol EPS une première fois avec une connexion.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
      }
    })());
    return;
  }

  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      const net = fetch(req).then(r => { if (r.ok || r.type === "opaque") cache.put(req, r.clone()); return r; }).catch(() => null);
      if (hit) { e.waitUntil(net); return hit; }
      return (await net) || new Response("", { status: 504 });
    })());
    return;
  }

  if (same && (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest")) {
    e.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const hit = await cache.match(req);
      if (hit) return hit;
      const r = await fetch(req); if (r.ok) cache.put(req, r.clone()); return r;
    })());
  }
});

/* Rappel quotidien : le message arrive chiffré, le navigateur le déchiffre avant de nous le donner. */
self.addEventListener("push", e => {
  let m = {}; try { m = e.data ? e.data.json() : {}; } catch (err) { m = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(m.title || "Bristol EPS", {
    body: m.body || "Ta séance du jour t'attend.", tag: m.tag || "bristol-rappel", renotify: false,
    icon: "/icons/icon-192.png", badge: "/icons/favicon-32.png", lang: "fr", data: { url: m.url || "/" },
  }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/", self.location.origin).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const w = all.find(c => new URL(c.url).origin === self.location.origin);
    if (w) { await w.focus(); return; }
    await self.clients.openWindow(url);
  })());
});
