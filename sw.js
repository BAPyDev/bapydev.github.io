"use strict";

const cachePrefix = "erp-portfolio:" + self.registration.scope + ":";
const cacheName = cachePrefix + "v11";
const assets = [
  "index.html", "style.css", "app.js", "production.js", "app.webmanifest",
  "spectrum/analyzer.js", "spectrum/capture.js", "portrait.jpg", "workshop.jpg", "lights-off.svg", "filaments.svg",
  "icons/icon-192.png", "icons/icon-512.png", "icons/apple-touch-icon.png"
].map(path => new URL(path, self.registration.scope).href);

self.addEventListener("install", event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets)));
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(cachePrefix) && key !== cacheName) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET") return;
  const key = request.mode === "navigate" && request.url.split("?")[0] === self.registration.scope
    ? assets[0] : request.url;
  if (!assets.includes(key)) return;
  event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(key)) || fetch(request)));
});
