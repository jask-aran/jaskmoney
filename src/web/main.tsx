/**
 * The web app: the TUI's four tabs in a browser, on the same core (client/store over a WebSocket), drawn with
 * Conduit's components v2 in jaskmoney's material (./v2, ./kit). Server/webBuild bundles it; server/serve serves it.
 *
 * The frame holds the sidebar (the tabs, the accounts, sync) and one inset pane: the tab. A tab mounts on its first
 * visit and then stays, hidden while another is shown, as the TUI's do. On a phone (or a narrow window) the sidebar
 * is a drawer.
 */
import { For, Show, createMemo, createSignal, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { LayoutDashboard, PiggyBank, ReceiptText, RefreshCw, Settings2, Undo2 } from "lucide-solid"
import { accountStacks } from "../domain/accountTree"
import { formatMoney } from "../domain/dashboard"
import { syncAgo } from "../domain/days"
import { applyTheme } from "./theme"
import { TABS, closeDrawer, compact, connection, data, drawer, lostReason, now, run, say, setTab, status, tab, useKeys, type TabId } from "./store"
import { AppShell, Button, Keycap, NavBrand, NavGroup, NavPane, NavRow, Sheet, StatusDot } from "./v2"
import { Overview } from "./tabs/Overview"
import { Transactions } from "./tabs/Transactions"
import { Budgets } from "./tabs/Budgets"
import { Settings } from "./tabs/Settings"

applyTheme()
document.documentElement.classList.add("dark")

const VIEWS: Record<TabId, () => JSX.Element> = {
  overview: () => <Overview />,
  transactions: () => <Transactions />,
  budgets: () => <Budgets />,
  settings: () => <Settings />,
}
const ICONS: Record<TabId, () => JSX.Element> = {
  overview: () => <LayoutDashboard />,
  transactions: () => <ReceiptText />,
  budgets: () => <PiggyBank />,
  settings: () => <Settings2 />,
}

/** Each tab's keys, for the status line. */
const HINTS: Record<TabId, Array<[string, string]>> = {
  overview: [["[ ]", "range"], ["u", "undo"]],
  transactions: [["/", "search"], ["?", "smart"], ["j k", "move"], ["c", "category"], ["x", "select"], ["↵", "details"]],
  budgets: [["[ ]", "cycle"], ["u", "undo"]],
  settings: [["u", "undo"]],
}

function syncLabel(): string {
  if (data.state.upSyncing) return "syncing…"
  const ago = syncAgo(data.state.dbInfo?.upLastSyncedAt ?? null, now())
  return ago ? `synced ${ago}` : data.state.upToken ? "not synced yet" : "no Up token"
}

/** The sidebar: the tabs, the accounts (choosing one shows its transactions), and the connection and sync. */
function Sidebar(props: { show: (id: TabId) => void }) {
  const stacks = createMemo(() => accountStacks(data.state.accounts))
  const toReview = createMemo(() => Object.keys(data.state.suggestions).length)
  const go = (id: TabId) => { props.show(id); closeDrawer() }
  return (
    <NavPane drawer={compact() ? (drawer() ? "open" : "shut") : undefined}
      head={<NavBrand name="jaskmoney" aria-label="jaskmoney" onClick={() => go("overview")} />}
      foot={
        <div class="jm-nav-foot">
          <span class="jm-conn" title={connection() === "lost" ? lostReason() : "Live: a change from any client shows at once"}>
            <StatusDot label={connection()} tone={connection() === "open" ? "success" : connection() === "lost" ? "danger" : "muted"} />
            <span>{connection() === "open" ? (data.state.demo ? "demo data" : syncLabel()) : connection() === "lost" ? "reconnecting…" : "connecting…"}</span>
          </span>
          <span class="grow" />
          <Button variant="ghost" size="icon-sm" aria-label="Undo" title={data.undoLabel() ? `Undo ${data.undoLabel()} (u)` : "Nothing to undo"} disabled={!data.undoLabel()}
            onClick={() => void run(data.undo())}><Undo2 /></Button>
          <Button variant="ghost" size="icon-sm" aria-label="Sync with Up" title={data.state.upToken ? "Sync with Up now" : "The core has no Up token"}
            disabled={data.state.upSyncing || data.state.demo || !data.state.upToken} onClick={() => { say("Syncing with Up…"); void run(data.syncUp()) }}><RefreshCw /></Button>
        </div>
      }>
      <NavGroup>
        <For each={TABS}>{(t, i) => (
          <NavRow icon={ICONS[t.id]()} current={tab() === t.id} onClick={() => go(t.id)}
            meta={t.id === "transactions" && toReview() ? `${toReview()} to review` : undefined}
            end={compact() ? undefined : <Keycap>{String(i() + 1)}</Keycap>}>{t.label}</NavRow>
        )}</For>
      </NavGroup>
      <Show when={data.state.ready}>
        <For each={stacks()}>{(stack) => (
          <NavGroup label={stack.label}>
            <For each={stack.rows}>{(row) => (
              <NavRow current={tab() === "transactions" && data.state.accountSelection === row.selection}
                meta={row.balance != null ? <span class="money">{formatMoney(row.balance)}</span> : undefined}
                onClick={() => { data.setAccountSelection(row.selection); go("transactions") }}>{row.label}</NavRow>
            )}</For>
          </NavGroup>
        )}</For>
      </Show>
    </NavPane>
  )
}

function App() {
  const [visited, setVisited] = createSignal(new Set<TabId>([tab()]))
  const show = (id: TabId) => { setTab(id); setVisited((v) => (v.has(id) ? v : new Set([...v, id]))) }
  useKeys((event) => {
    const n = Number(event.key)
    if (n >= 1 && n <= TABS.length) { show(TABS[n - 1]!.id); return true }
    if (event.key === "u" && data.undoLabel()) { void run(data.undo()); return true }
    if (event.key === "Escape" && drawer()) { closeDrawer(); return true }
    return false
  })
  // A tab chosen by the address (back, a link) is visited too.
  const current = () => { const id = tab(); if (!visited().has(id)) queueMicrotask(() => show(id)); return id }
  return (
    <div class="jm-app">
      <Sidebar show={show} />
      <Show when={compact() && drawer()}><button type="button" class="jm-drawer-backdrop" aria-label="Close the menu" onClick={closeDrawer} /></Show>
      <AppShell>
        <Sheet as="main" lead>
          <div class="jm-sheet">
            <Show when={data.state.ready} fallback={<div class="jm-empty">{connection() === "lost" ? `Can't reach jaskmoney: ${lostReason()}. Trying again…` : "Connecting to jaskmoney…"}</div>}>
              <For each={TABS}>{(t) => (
                <Show when={visited().has(t.id)}>
                  <div class="jm-tab" style={{ display: current() === t.id ? "flex" : "none" }}>{VIEWS[t.id]()}</div>
                </Show>
              )}</For>
            </Show>
            <footer class="jm-status">
              <span class="msg" data-error={status().err ? "" : undefined}>{status().text}</span>
              <span class="hints"><For each={HINTS[tab()]}>{([key, what]) => <span><Keycap>{key}</Keycap> {what}</span>}</For></span>
            </footer>
          </div>
        </Sheet>
      </AppShell>
    </div>
  )
}

render(() => <App />, document.getElementById("app")!)
