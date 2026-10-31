/**
 * The installed app and its updates (the worker is web/sw.js). Only the app opened from a home screen
 * registers the worker; a browser tab loads the newest build each visit and has nothing to update.
 *
 * The installed app stays on the build it has. It looks for a newer one when it opens, when it comes back to
 * the front and when asked (Settings › App › Check); a newer build downloads in the background and waits as
 * "ready" until Update, which switches to it and reloads.
 */
import { createSignal } from "solid-js"

export interface Build { version: string; built: string }
export type AppState =
  | { kind: "browser" } // not installed: nothing to update
  | { kind: "unsupported" } // installed, but no service workers here (not https, an old browser)
  | { kind: "starting" }
  | { kind: "current" }
  | { kind: "checking" }
  | { kind: "downloading" }
  | { kind: "ready"; next: Build | null }
  | { kind: "failed"; why: string }

/** This page's build, as the server named it in the page. */
const meta = document.querySelector<HTMLMetaElement>('meta[name="jaskmoney-build"]')
export const build: Build | null = meta ? { version: meta.content, built: meta.dataset.built ?? "" } : null

/** Opened from a home screen (iOS says so its own way). */
export const installed = matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true

const [state, setState] = createSignal<AppState>(installed ? ("serviceWorker" in navigator ? { kind: "starting" } : { kind: "unsupported" }) : { kind: "browser" })
export { state as appState }

let registration: ServiceWorkerRegistration | null = null

/** What a worker says its build is. */
function buildOf(worker: ServiceWorker): Promise<Build | null> {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(null), 2000)
    channel.port1.onmessage = (event) => { clearTimeout(timer); resolve(event.data as Build) }
    worker.postMessage("build", [channel.port2])
  })
}

/** Workers already watched to finish installing. */
const watched = new WeakSet<ServiceWorker>()

/**
 * Where the update stands: a build waiting to take over is ready (or, when this page is that build already,
 * the worker just catches up); one still installing is downloading. A worker installing is always watched,
 * even with another waiting: the newer replaces it once it's in.
 */
async function settle(): Promise<void> {
  if (!registration) return
  const installing = registration.installing
  if (installing && !watched.has(installing)) {
    watched.add(installing)
    installing.addEventListener("statechange", () => { if (installing.state === "installed" || installing.state === "redundant") void settle() })
  }
  const waiting = registration.waiting
  if (waiting) {
    const next = await buildOf(waiting)
    // This page is that build already (loaded from the server): the worker just catches up, no reload.
    if (next && build && next.version === build.version) { waiting.postMessage("update"); setState({ kind: "current" }); return }
    setState({ kind: "ready", next })
    return
  }
  setState(installing ? { kind: "downloading" } : { kind: "current" })
}

/** Ask the server whether there's a newer build. */
export async function checkForUpdate(): Promise<void> {
  if (!registration) return
  // Even with an update ready: a newer build may have come since, and takes its place.
  if (state().kind === "downloading") return
  if (state().kind !== "ready") setState({ kind: "checking" })
  try {
    await registration.update()
    await settle()
  } catch (error) {
    setState({ kind: "failed", why: error instanceof Error ? error.message : String(error) })
  }
}

/** Switch to the waiting build: the worker takes over and the page reloads on it. */
export function applyUpdate(): void {
  const waiting = registration?.waiting
  if (!waiting) return
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true })
  waiting.postMessage("update")
}

/** Load the page from the server, past the kept build (signing in again, a broken build). */
export function reloadFromServer(): void {
  location.replace(`/?network${location.hash}`)
}

/** Register (the installed app only), then look for updates now and whenever the app comes back to the front. */
export async function startApp(): Promise<void> {
  if (!("serviceWorker" in navigator)) return
  // Back from `?network`: the address is the app's own again.
  if (location.search.includes("network")) history.replaceState(null, "", `/${location.hash}`)
  try {
    // A browser tab registers nothing, but where the browser shares the installed app's worker (Chrome on
    // Android) the tab is on the kept build too, so it gets the same updates.
    const existing = installed ? null : await navigator.serviceWorker.getRegistration("/")
    if (!installed && !existing) return
    registration = existing ?? await navigator.serviceWorker.register("/sw.js", { scope: "/" })
    registration.addEventListener("updatefound", () => void settle())
    await settle()
    void checkForUpdate()
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void checkForUpdate() })
  } catch (error) {
    setState({ kind: "failed", why: error instanceof Error ? error.message : String(error) })
  }
}

/** When a build was made, as people say it: 31 Oct, 2:04 pm. */
export function builtLabel(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("en-AU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })
}
