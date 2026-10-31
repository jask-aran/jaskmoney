/**
 * The web app: the TUI's four tabs in a browser, on the same core (client/
 * store over a WebSocket). Server/webBuild bundles it; server/serve serves
 * it. A tab mounts on its first visit and then stays, hidden while another
 * is shown, as the TUI's do.
 */
import { For, Show, createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { syncAgo } from "../domain/days"
import { applyTheme } from "./theme"
import { TABS, connection, data, lostReason, now, run, say, setTab, status, tab, useKeys, type TabId } from "./store"
import { Overview } from "./tabs/Overview"
import { Transactions } from "./tabs/Transactions"
import { Budgets } from "./tabs/Budgets"
import { Settings } from "./tabs/Settings"

applyTheme()

const VIEWS: Record<TabId, () => JSX.Element> = {
  overview: () => <Overview />,
  transactions: () => <Transactions />,
  budgets: () => <Budgets />,
  settings: () => <Settings />,
}

/** Each tab's keys, for the status line. */
const HINTS: Record<TabId, string> = {
  overview: "1-4 tabs  [ ] range  u undo",
  transactions: "/ search  ? smart search  j/k move  c category  x select  enter details  u undo",
  budgets: "1-4 tabs  [ ] cycle  u undo",
  settings: "1-4 tabs  u undo",
}

function syncLabel(): string {
  if (data.state.upSyncing) return "syncing…"
  const ago = syncAgo(data.state.dbInfo?.upLastSyncedAt ?? null, now())
  return ago ? `synced ${ago}` : data.state.upToken ? "not synced yet" : ""
}

function TopBar() {
  const undo = () => { if (data.undoLabel()) void run(data.undo()) }
  return (
    <header class="topbar">
      <span class="brand">jaskmoney</span>
      <nav class="tabs">
        <For each={TABS}>{(t, i) => (
          <button type="button" class="tab" classList={{ active: tab() === t.id }} onClick={() => setTab(t.id)}>
            {t.label}<kbd>{i() + 1}</kbd>
          </button>
        )}</For>
      </nav>
      <div class="end">
        <Show when={data.state.demo}><span class="badge">DEMO</span></Show>
        <span class="conn" classList={{ off: connection() === "lost" }} title={connection() === "lost" ? lostReason() : "Live: changes from any client show at once"}>
          <span class="dot" />
          <span class="hide-narrow">{connection() === "open" ? "live" : connection() === "lost" ? "reconnecting…" : "connecting…"}</span>
        </span>
        <Show when={!data.state.demo && syncLabel()}><span class="small note hide-narrow">{syncLabel()}</span></Show>
        <button type="button" class="btn small ghost" disabled={!data.undoLabel()} title={data.undoLabel() ? `Undo ${data.undoLabel()} (u)` : "Nothing to undo"} onClick={undo}>Undo</button>
        <button type="button" class="btn small" disabled={data.state.upSyncing || data.state.demo || !data.state.upToken}
          title={data.state.upToken ? "Sync with Up now" : "The core has no Up token"}
          onClick={() => { say("Syncing with Up…"); void run(data.syncUp()) }}>Sync</button>
      </div>
    </header>
  )
}

function App() {
  const [visited, setVisited] = createSignal(new Set<TabId>([tab()]))
  const show = (id: TabId) => { setTab(id); setVisited((v) => (v.has(id) ? v : new Set([...v, id]))) }
  useKeys((event) => {
    const n = Number(event.key)
    if (n >= 1 && n <= TABS.length) { show(TABS[n - 1]!.id); return true }
    if (event.key === "u" && data.undoLabel()) { void run(data.undo()); return true }
    return false
  })
  // A tab chosen by the address (back, a link) is visited too.
  const current = () => { const id = tab(); if (!visited().has(id)) queueMicrotask(() => show(id)); return id }
  return (
    <div class="app">
      <TopBar />
      <main class="page">
        <Show when={data.state.ready} fallback={<div class="empty">{connection() === "lost" ? `Can't reach jaskmoney: ${lostReason()}. Trying again…` : "Connecting to jaskmoney…"}</div>}>
          <For each={TABS}>{(t) => (
            <Show when={visited().has(t.id)}>
              <div style={{ display: current() === t.id ? "contents" : "none" }}>{VIEWS[t.id]()}</div>
            </Show>
          )}</For>
        </Show>
      </main>
      <footer class="statusbar">
        <span class="msg" classList={{ err: status().err }}>{status().text}</span>
        <span class="hints">{HINTS[tab()]}</span>
      </footer>
    </div>
  )
}

render(() => <App />, document.getElementById("app")!)
