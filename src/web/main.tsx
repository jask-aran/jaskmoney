/**
 * The web app: the TUI's four tabs in a browser, on the same core (client/store over a WebSocket), drawn with
 * Conduit's components v2 in jaskmoney's material (./v2, ./kit). Server/webBuild bundles it; server/serve serves it.
 *
 * The frame holds the sidebar (the tabs, the accounts, sync) and one inset pane: the tab. A tab mounts on its first
 * visit and then stays, hidden while another is shown, as the TUI's do. On a phone (or a narrow window) the tabs are
 * a bar along the bottom and the status line is a toast.
 */
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup, type JSX } from "solid-js"
import { render } from "solid-js/web"
import { LayoutDashboard, PiggyBank, ReceiptText, RefreshCw, Settings2, Undo2 } from "lucide-solid"
import { accountStacks } from "../domain/accountTree"
import { formatMoney } from "../domain/dashboard"
import { applyTheme } from "./theme"
import { TABS, compact, connection, data, lostReason, run, say, setTab, status, syncLabel, tab, useKeys, type TabId } from "./store"
import { AppShell, Button, Keycap, NavBrand, NavGroup, NavPane, NavRow, Sheet, StatusDot, Toast } from "./v2"
import { TabBar } from "./kit"
import { Overview } from "./tabs/Overview"
import { Transactions } from "./tabs/Transactions"
import { Budgets } from "./tabs/Budgets"
import { Settings } from "./tabs/Settings"
import { Palette } from "./palette"

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
  transactions: [["/", "search"], ["?", "smart"], ["j k", "move"], ["c", "category"], ["x", "select"], ["↵", "details"], ["⌃K", "all"]],
  budgets: [["[ ]", "cycle"], ["u", "undo"]],
  settings: [["u", "undo"]],
}

/** The sidebar: the tabs, the accounts (choosing one shows its transactions), and the connection and sync. */
function Sidebar(props: { show: (id: TabId) => void }) {
  const stacks = createMemo(() => accountStacks(data.state.accounts))
  const toReview = createMemo(() => Object.keys(data.state.suggestions).length)
  const go = (id: TabId) => props.show(id)
  return (
    <NavPane
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
    return false
  })
  // ctrl+k (⌘K): every command, as the TUI's palette; from anywhere, text fields included.
  const [palette, setPalette] = createSignal(false)
  const onPaletteKey = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") { event.preventDefault(); setPalette((open) => !open) }
  }
  window.addEventListener("keydown", onPaletteKey)
  onCleanup(() => window.removeEventListener("keydown", onPaletteKey))
  // A phone's status line: a toast over the tab bar for a few seconds, with Undo when there's something to undo.
  const [toast, setToast] = createSignal<{ text: string; err: boolean } | null>(null)
  let toastTimer: ReturnType<typeof setTimeout> | undefined
  createEffect(on(status, (next) => {
    clearTimeout(toastTimer)
    if (!compact() || !next.text) { setToast(null); return }
    setToast(next)
    toastTimer = setTimeout(() => setToast(null), next.err ? 6000 : 3500)
  }, { defer: true }))
  const reviewCount = createMemo(() => Object.keys(data.state.suggestions).length)
  // A tab chosen by the address (back, a link) is visited too.
  const current = () => { const id = tab(); if (!visited().has(id)) queueMicrotask(() => show(id)); return id }
  return (
    <div class="jm-app" data-compact={compact() ? "" : undefined}>
      <Show when={!compact()}><Sidebar show={show} /></Show>
      <Show when={palette()}><Palette onClose={() => setPalette(false)} /></Show>
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
      <Show when={compact()}>
        <TabBar tabs={TABS.map((t) => ({ id: t.id, label: t.label, icon: ICONS[t.id](), badge: t.id === "transactions" ? reviewCount() : null }))} current={tab()} onChoose={show} />
        <Show when={toast()}>{(t) => (
          <div class="jm-toasts">
            <Toast kind={t().err ? "error" : "info"} onDismiss={() => setToast(null)}
              action={!t().err && data.undoLabel() ? { label: "Undo", onClick: () => { setToast(null); void run(data.undo()) } } : undefined}>{t().text}</Toast>
          </div>
        )}</Show>
      </Show>
    </div>
  )
}

render(() => <App />, document.getElementById("app")!)
