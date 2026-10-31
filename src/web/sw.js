/*
 * The installed app's service worker (server/webBuild serves it as /sw.js, with `BUILD` set above this:
 * { version, built, files }). It keeps one build's files, so the app opens at once and stays on the build
 * it has. A newer build installs beside it and waits: the app says when to switch (Settings › App › Update,
 * or the toast), never the worker by itself. Only the installed app registers it (web/pwa.ts); a browser
 * tab loads the newest build each visit.
 *
 * Not kept: the core's WebSocket (/api) and this file. A page address with `?network` skips the kept page
 * (signing in to whatever stands in front of the core, a reload from the server).
 */
/* global BUILD */
const CACHE = `jaskmoney-${BUILD.version}`

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(BUILD.files)))
})

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("jaskmoney-") && key !== CACHE) await caches.delete(key)
    await self.clients.claim()
  })())
})

self.addEventListener("message", (event) => {
  if (event.data === "update") self.skipWaiting()
  else if (event.data === "build") event.ports[0]?.postMessage({ version: BUILD.version, built: BUILD.built })
})

self.addEventListener("fetch", (event) => {
  const request = event.request
  const url = new URL(request.url)
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname === "/api" || url.pathname === "/sw.js") return
  if (request.mode === "navigate" && url.searchParams.has("network")) return
  const key = request.mode === "navigate" ? "/" : url.pathname
  event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(key)) ?? fetch(request)))
})
