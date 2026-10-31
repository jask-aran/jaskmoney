/**
 * The web app's state: the core's (client/store over a WebSocket, which
 * reconnects by itself when the core restarts), and the page's own (the
 * tab, the status line), kept in this browser.
 */
import { createSignal, onCleanup } from "solid-js"
import { createClientStore } from "../client/store"
import { wsLink } from "../client/wsLink"
import { syncAgo } from "../domain/days"

const api = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api`

export type Connection = "connecting" | "open" | "lost"
const [connection, setConnection] = createSignal<Connection>("connecting")
const [lostReason, setLostReason] = createSignal("")
export { connection, lostReason }

let retryMs = 500
function openLink() {
  return wsLink(api, {
    onOpen: () => { retryMs = 500; setConnection("open") },
    onClose: (reason) => {
      setConnection("lost")
      setLostReason(reason)
      // The core restarts with the TUI (dev reloads it on every save): try again.
      setTimeout(() => data.connect(openLink()), retryMs)
      retryMs = Math.min(retryMs * 2, 5000)
    },
  })
}

/** The core's state and commands, as every client sees them. */
export const data = createClientStore(openLink())

export type TabId = "overview" | "transactions" | "budgets" | "settings"
export const TABS: Array<{ id: TabId; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "transactions", label: "Transactions" },
  { id: "budgets", label: "Budgets" },
  { id: "settings", label: "Settings" },
]

const tabFromHash = (): TabId => {
  const id = location.hash.slice(1)
  return TABS.some((t) => t.id === id) ? (id as TabId) : "overview"
}
const [tab, setTabSignal] = createSignal<TabId>(tabFromHash())
window.addEventListener("hashchange", () => setTabSignal(tabFromHash()))
export { tab }
export function setTab(id: TabId): void {
  if (location.hash.slice(1) !== id) history.replaceState(null, "", `#${id}`)
  setTabSignal(id)
}

/** Too narrow for the sidebar beside a tab (a phone, or a narrow window): the tabs are a bar along the bottom. */
const compactQuery = window.matchMedia("(max-width: 760px)")
const [compact, setCompact] = createSignal(compactQuery.matches)
compactQuery.addEventListener("change", (event) => setCompact(event.matches))
export { compact }

/** The status line: what the last action did, or why it failed. */
const [status, setStatus] = createSignal<{ text: string; err: boolean }>({ text: "", err: false })
export { status }
export const say = (text: string, err = false) => setStatus({ text, err })
export const fail = (error: unknown) => say(error instanceof Error ? error.message : String(error), true)
/** Run a command, saying what it answered (or why it failed). */
export function run<T>(promise: Promise<T>, done?: (value: T) => string | void): Promise<T | undefined> {
  return promise.then((value) => {
    const text = done ? done(value) : typeof value === "string" ? value : undefined
    if (text) say(text)
    return value
  }, (error) => { fail(error); return undefined })
}

/** Now, every 30 seconds ("synced 4m ago"). */
const [now, setNow] = createSignal(Date.now())
setInterval(() => setNow(Date.now()), 30_000)
export { now }

/** When Up last synced, in the sidebar's (and Settings') words: syncing…, synced 4m ago, not synced yet. */
export function syncLabel(): string {
  if (data.state.upSyncing) return "syncing…"
  const ago = syncAgo(data.state.dbInfo?.upLastSyncedAt ?? null, now())
  return ago ? `synced ${ago}` : data.state.upToken ? "not synced yet" : "no Up token"
}

/** Keys for a tab while it's shown; text fields keep their keys. */
export function useKeys(handler: (event: KeyboardEvent) => boolean | void): void {
  const listener = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return
    const target = event.target as HTMLElement | null
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
    if (handler(event)) event.preventDefault()
  }
  window.addEventListener("keydown", listener)
  onCleanup(() => window.removeEventListener("keydown", listener))
}

/** A browser-kept preference (a chart view, a range): this browser only. */
export function kept<T>(key: string, initial: T): [() => T, (value: T) => void] {
  let start = initial
  try {
    const raw = localStorage.getItem(`jaskmoney.${key}`)
    if (raw != null) start = JSON.parse(raw) as T
  } catch { /* storage blocked */ }
  const [value, setValue] = createSignal<T>(start)
  return [value, (next: T) => {
    setValue(() => next)
    try { localStorage.setItem(`jaskmoney.${key}`, JSON.stringify(next)) } catch { /* storage blocked */ }
  }]
}
