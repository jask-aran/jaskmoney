import { settleData, toggleDemo } from "./actions"
import { BudgetsTab } from "../ui/budgets/BudgetsTab"
import { ErrorBoundary, Show, createEffect, createMemo, createSignal, untrack, on, onCleanup, onMount } from "solid-js"
import { useKeyboard, usePaste, useRenderer } from "@opentui/solid"
import type { KeyEvent } from "@opentui/core"
import { ui, type SectionId, type TabId } from "../state/uiStore"
import type { JSX } from "@opentui/solid"
import { data } from "../state/dataStore"
import { footerLine, handleKey, hintState, paletteList, scopeQuits, handlePaste } from "./keys"
import { CommandPalette } from "../ui/primitives/CommandPalette"
import { appNow } from "../domain/days"
import { TabBar } from "../ui/primitives/TabBar"
import { UP_LOGO_WIDTH, UpLogo } from "../ui/primitives/UpLogo"
import { StatusBar } from "../ui/primitives/StatusBar"
import { Footer } from "../ui/primitives/Footer"
import { JumpOverlay } from "../ui/primitives/JumpOverlay"
import { CatPicker } from "../ui/primitives/CatPicker"
import { TagChooser } from "../ui/primitives/TagChooser"
import { MerchantNoteBox } from "../ui/manager/MerchantNoteBox"
import { SearchHelp } from "../ui/manager/SearchHelp"
import { AiQueryView, AiUseDialog } from "../ui/settings/AiUseDialogs"
import { TagPicker } from "../ui/primitives/TagPicker"
import { OverviewTab } from "../ui/overview/OverviewTab"
import { ManagerTab } from "../ui/manager/ManagerTab"
import { SavedFilterPicker } from "../ui/manager/SavedFilterPicker"
import { SettingsTab, EditorOverlay, DryRunOverlay, AiDialog, UpAccountsDialog } from "../ui/settings/SettingsTab"
import { ExecutorDialog } from "../ui/settings/ExecutorDialog"
import { theme, ink, tone } from "../theme"
import { selectionLabel } from "../domain/accountTree"
import { SYNC_INTERVAL_MS, runSync, syncAgo } from "./sync"
import { activeChipIndex } from "../domain/timeframe"
import type { UiPrefs } from "../state/settingsConfig"
import { restoreUiPrefs } from "../state/uiPrefs"
import { wsLink } from "../client/wsLink"

/** A flag's value: `--name=value` or `--name value`, "" when it has none, null when absent. */
function flagValue(name: string): string | null {
  const args = process.argv
  const i = args.findIndex((a) => a === name || a.startsWith(`${name}=`))
  if (i < 0) return null
  if (args[i]!.includes("=")) return args[i]!.slice(name.length + 1)
  const next = args[i + 1]
  return next && !next.startsWith("--") ? next : ""
}


/** "1 web client", or nothing when none is connected. */
export const webClientsLabel = (count: number) => (count ? `${count} web client${count === 1 ? "" : "s"}` : "")

export function App() {
  const renderer = useRenderer()

  const [bootstrapped, setBootstrapped] = createSignal(false)
  // The same array until the palette reopens or its query changes (keys'
  // paletteList), so a cursor move leaves the palette's rows alone.
  const paletteCommands = createMemo(() => ui.state.palette ? paletteList(ui, data) : [])

  // `--connect <ws url>`: a core elsewhere (bun run server, or a TUI's
  // --serve). Otherwise the core is this process's; `--serve[=port]` serves
  // it to the web app and other clients too.
  const remote = flagValue("--connect")
  const serving = remote == null ? flagValue("--serve") : null
  let servedAt = ""
  // Clients of the core this TUI serves (the web app), for the top bar.
  const [webClients, setWebClients] = createSignal(0)

  function bootstrap() {
    try {
      // `jaskmoney --demo` opens straight into demo mode (your data untouched).
      const demo = process.argv.includes("--demo")
      // Over a socket, demo mode arrives later: the first sync waits for it.
      const demoReady = demo ? toggleDemo(ui, data) : Promise.resolve()
      const restored = restoreUiPrefs(data.state.uiPrefs, data.state.accounts, appNow(), data.cycle())
      ui.setTimeframe(restored.timeframe)
      ui.setDashChipCursor(activeChipIndex(restored.timeframe))
      data.setAccountSelection(restored.accountSelection)
      if (restored.chartViews) ui.setState({ chartViews: restored.chartViews })
      setBootstrapped(true)

      if (demo) {
        // toggleDemo's status says what demo mode is.
      } else if (data.state.transactions.length > 0) {
        ui.setStatus(`${data.state.transactions.length} transactions loaded.${remote ? " · on a remote core" : ""}${servedAt}`)
      } else {
        ui.setStatus("No transactions yet · Settings → Database & Import → i to import")
      }
      // Sync now, then on an interval; ctrl+r syncs on demand.
      void demoReady.then(() => runSync(ui, data, { manual: false }))
      const timer = setInterval(() => void runSync(ui, data, { manual: false }), SYNC_INTERVAL_MS)
      onCleanup(() => clearInterval(timer))
    } catch (e) {
      ui.setStatus(`DB error: ${e instanceof Error ? e.message : String(e)}`, true)
    }
  }

  onMount(() => {
    if (remote) {
      let quitting = false
      const link = wsLink(remote, { onClose: (reason) => { if (!quitting) ui.setStatus(`Lost the core: ${reason}`, true) } })
      // An open socket would keep the process alive after quitting.
      onCleanup(() => { quitting = true; link.close() })
      data.connect(link)
      ui.setStatus("Connecting to the core…")
      return
    }
    try {
      data.init(process.env.JASKMONEY_DB)
      if (serving != null) {
        const { serveCore, DEFAULT_PORT } = require("../server/serve") as typeof import("../server/serve")
        const served = serveCore(data.core, { port: Number(serving) || DEFAULT_PORT, onClients: setWebClients })
        // A listening server would keep the process alive after quitting.
        onCleanup(() => served.stop())
        servedAt = ` · web app at ${served.page}`
      }
    } catch (e) {
      ui.setStatus(`DB error: ${e instanceof Error ? e.message : String(e)}`, true)
      return
    }
    if (process.env.JASKMONEY_NO_BOOTSTRAP === "1") {
      ui.setStatus("OpenTUI shell · bootstrap off")
      return
    }
    bootstrap()
  })

  // A remote core's state arrives after mount: start once it has.
  createEffect(() => {
    if (remote && data.state.ready && !untrack(bootstrapped)) untrack(bootstrap)
  })

  createEffect(() => {
    if (process.env.JASKMONEY_NO_BOOTSTRAP === "1" || !bootstrapped()) return
    const tf = ui.state.timeframe
    const prefs: UiPrefs = {
      timeframe: { family: tf.family, lookback: tf.lookback, period: tf.period, custom: tf.custom ? { start: tf.custom.start, end: tf.custom.end } : null },
      accountSelection: data.state.accountSelection,
      chartViews: [ui.state.chartViews[0], ui.state.chartViews[1]],
    }
    // Written once keys settle: these change on every [ ] d a h l.
    untrack(() => settleData(ui, data.saveUiPrefs(prefs, { soon: true })))
  })

  // Re-render the "synced Xm ago" label every 30 seconds.
  const [now, setNow] = createSignal(Date.now())
  const tick = setInterval(() => setNow(Date.now()), 30_000)
  onCleanup(() => clearInterval(tick))
  const syncLabel = () => {
    if (data.state.upSyncing) return "syncing…"
    const ago = syncAgo(data.state.dbInfo?.upLastSyncedAt ?? null, now())
    return ago ? `synced ${ago}` : ""
  }

  useKeyboard((key: KeyEvent) => {
    // ctrl+c quits anywhere; q quits where it cannot be text (Go app).
    if ((key.ctrl && key.name === "c") || (key.name === "q" && !key.ctrl && !key.meta && !key.shift && scopeQuits(ui.activeScope()))) {
      renderer.destroy()
      return
    }
    handleKey(ui, key, data)
  })

  // A paste arrives whole (bracketed paste), not as key presses.
  usePaste((event) => {
    if (handlePaste(ui, new TextDecoder().decode(event.bytes), data)) event.preventDefault()
  })

  // The Manager's account selection; the other tabs are not account-scoped.
  const accountLabel = () => {
    if (data.state.accounts.length === 0) return "No accounts"
    return ui.state.activeTab === "manager" ? selectionLabel(data.state.accounts, data.state.accountSelection) : ""
  }

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.canvas}>
      {/* The Up mark sits in the Overview's top-right corner, over the tab
          bar, the gap and the Date Range, which end short of it. */}
      <TabBar
        active={ui.state.activeTab}
        accountLabel={[data.state.demo ? "DEMO" : "", accountLabel(), webClientsLabel(webClients()), data.state.demo ? "" : syncLabel()].filter(Boolean).join(" · ")}
        reserveRight={ui.state.activeTab === "overview" ? UP_LOGO_WIDTH : 0}
      />
      <box height={1} width="100%" backgroundColor={theme.canvas} />
      <box flexGrow={1} width="100%" flexDirection="column" backgroundColor={theme.canvas}>
        {/* Each tab mounts on its first visit and then stays, hidden while
            another is shown: switching tabs shows it rather than building it
            again (~30ms on a full database). A rendering error stays inside
            its tab, so the rest of the app (tab switching, quit) works;
            switching tabs retries. */}
        <KeptTab id="overview">{(focused) => <OverviewTab focused={focused()} />}</KeptTab>
        <KeptTab id="manager">{(focused) => <ManagerTab focused={focused()} />}</KeptTab>
        <KeptTab id="budgets">{(focused) => <BudgetsTab focused={focused()} />}</KeptTab>
        <KeptTab id="settings">{(focused) => <SettingsTab focused={focused()} />}</KeptTab>
      </box>
      {/* Jump mode borrows the status line while active; the stored status
          returns unchanged when it closes. */}
      <StatusBar
        text={ui.state.jumpMode ? "Jump mode · press target letter" : ui.state.status}
        isErr={!ui.state.jumpMode && ui.state.statusErr}
      />
      <Footer hints={footerLine(ui.activeScope(), hintState(ui, data))} />
      <Show when={ui.state.activeTab === "overview"}>
        <UpLogo />
      </Show>
      <JumpOverlay active={ui.state.jumpMode} tab={ui.state.activeTab} />
      <CatPicker />
      <TagChooser />
      <MerchantNoteBox />
      <SearchHelp />
      <AiUseDialog />
      <AiQueryView />
      <AiDialog />
      <ExecutorDialog />
      <UpAccountsDialog />
      <TagPicker />
      <EditorOverlay />
      <SavedFilterPicker />
      <DryRunOverlay />
      <Show when={ui.state.palette}>
        {(palette: () => NonNullable<typeof ui.state.palette>) => (
          <CommandPalette commands={paletteCommands()} cursor={palette().cursor} query={palette().query} lastId={ui.state.lastCommandId} />
        )}
      </Show>
    </box>
  )
}

/** A tab, mounted from its first visit on and shown while active. Hidden,
 * its focus stays as it was: focus moves elsewhere don't redraw it. */
function KeptTab(props: { id: TabId; children: (focused: () => SectionId) => JSX.Element }) {
  const active = () => ui.state.activeTab === props.id
  const [visited, setVisited] = createSignal(active())
  createEffect(() => { if (active()) setVisited(true) })
  const focused = createMemo<SectionId>((was) => (active() ? ui.state.focusedSection : was), ui.state.focusedSection)
  return (
    <Show when={visited()}>
      <box visible={active()} flexGrow={1} width="100%" flexDirection="column">
        <ErrorBoundary fallback={(error: unknown, reset: () => void) => <TabError error={error} reset={reset} />}>
          {props.children(focused)}
        </ErrorBoundary>
      </box>
    </Show>
  )
}

function TabError(props: { error: unknown; reset: () => void }) {
  // Retry when the user switches tab.
  createEffect(on(() => ui.state.activeTab, () => props.reset(), { defer: true }))
  const message = () => (props.error instanceof Error ? props.error.message : String(props.error))
  return (
    <box border borderStyle="rounded" borderColor={tone.bad} paddingLeft={1} paddingRight={1} flexDirection="column">
      <text fg={tone.bad}>
        <b>This tab failed to render</b>
      </text>
      <text fg={ink.figure}>{message()}</text>
      <text fg={ink.note}>Switch tabs to retry · ctrl+c quits</text>
    </box>
  )
}
