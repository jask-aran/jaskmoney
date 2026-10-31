/*
 * The installed app's service worker (server/webBuild serves it as /sw.js, with `BUILD` set above this:
 * { version, built, files }). It keeps one build's files, so the app opens at once and stays on the build
 * it has. A newer build installs beside it and waits: the app says when to switch (Settings › App › Update,
 * or the toast), or it takes over once the app is closed altogether, never while it's open.
 *
 * Every tab registers it (a browser offers to install only a page with a worker), but only the installed app's
 * page is kept: its address is `/?app` (the manifest's start_url). A tab's page comes from the server each
 * visit, so a tab is always on the newest build; the hashed files it asks for are the same either way.
 *
 * Not kept: the core's WebSocket (/api) and this file. `?network` loads the page from the server even in the
 * app (signing in to whatever stands in front of the core, a reload from the server).
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
  if (request.mode === "navigate" && (!url.searchParams.has("app") || url.searchParams.has("network"))) return
  const key = request.mode === "navigate" ? "/" : url.pathname
  event.respondWith(caches.open(CACHE).then(async (cache) => (await cache.match(key)) ?? fetch(request)))
})
