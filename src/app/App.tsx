import { web, webLabel } from "./webApp"
import { paintWith } from "./afterPaint"
import { openWelcome, restingStatus, shouldWelcome } from "./welcome"
import { welcomeStatus } from "../state/welcome"
import { Welcome } from "../ui/welcome/Welcome"
import { traceFrames, traceKey, traceMark } from "./trace"
import { settleData, toggleDemo } from "./actions"
import { BudgetsTab } from "../ui/budgets/BudgetsTab"
import { ErrorBoundary, Show, createEffect, createMemo, createSignal, untrack, on, onCleanup } from "solid-js"
import { useKeyboard, usePaste, useRenderer } from "@opentui/solid"
import type { KeyEvent } from "@opentui/core"
import { TABS, TAB_DEFAULT_FOCUS, ui, type SectionId, type TabId } from "../state/uiStore"
import type { JSX } from "@opentui/solid"
import { data } from "../state/dataStore"
import { footerLine, handleKey, hintState, paletteList, handlePaste } from "./keys"
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

      // toggleDemo's status says what demo mode is.
      if (!demo) restingStatus(ui, data)
      // The first time (no Up token, setup not yet been through), or asked
      // for: the first-run setup, over the app.
      if (process.argv.includes("--welcome") || (!demo && shouldWelcome(data))) openWelcome(ui)
      // Sync now, then on an interval; ctrl+r syncs on demand.
      void demoReady.then(() => runSync(ui, data, { manual: false }))
      const timer = setInterval(() => void runSync(ui, data, { manual: false }), SYNC_INTERVAL_MS)
      onCleanup(() => clearInterval(timer))
      onCleanup(warmTabs())
    } catch (e) {
      ui.setStatus(`DB error: ${e instanceof Error ? e.message : String(e)}`, true)
    }
  }

  // Before the tree below is built, so it is built once, with the data,
  // rather than empty and then again (~80 ms of every start).
  ;(() => {
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
      traceMark("init start")
      data.init(process.env.JASKMONEY_DB)
      traceMark("database loaded")
      if (serving != null) {
        const { serveCore, DEFAULT_PORT } = require("../server/serve") as typeof import("../server/serve")
        // The core then broadcasts where it serves and who is connected.
        const served = serveCore(data.core, { port: Number(serving) || DEFAULT_PORT })
        // A listening server would keep the process alive after quitting.
        onCleanup(() => served.stop())
        ui.setStatus(`Web app at ${served.page}`)
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
  })()

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
    // ctrl+c quits, anywhere. Approved deviation from the Go app, where q
    // also quit outside text: one stray key away (2026-11-01, the user
    // quit by accident in a first-run test).
    if (key.ctrl && key.name === "c") {
      renderer.destroy()
      return
    }
    traceKey(key, ui.activeScope(), () => handleKey(ui, key, data))
  })
  traceFrames(renderer)
  onCleanup(paintWith(renderer))

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
        items={[
          { text: data.state.demo ? "DEMO" : "" },
          { text: accountLabel() },
          { id: "bar.web", text: webLabel(web.serving()) },
          { id: "bar.sync", text: data.state.demo ? "" : syncLabel() },
        ]}
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
      {/* Jump mode and the setup borrow the status line while open; the log's
          latest status returns unchanged when they close. */}
      <StatusBar
        text={ui.state.jump != null ? "Jump mode · press target letter" : ui.state.welcome ? welcomeStatus(ui.state.welcome, data.state.uiPrefs.backdrop) : ui.state.status}
        isErr={ui.state.jump == null && !ui.state.welcome && ui.state.statusErr}
      />
      <Footer hints={footerLine(ui.activeScope(), hintState(ui, data))} />
      <Show when={ui.state.activeTab === "overview"}>
        <UpLogo />
      </Show>
      <JumpOverlay active={(ui.state.jump != null)} tab={ui.state.activeTab} />
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
      <Welcome />
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
/** Tabs built ahead of their first visit (App's warm-up after start). */
const [warmed, setWarmed] = createSignal<ReadonlySet<TabId>>(new Set())

/** Build the tabs not yet shown, one at a time while the app is idle, so a
 * first visit is a switch (~5 ms) rather than a build (50-120 ms). Each
 * waits its turn after the last, so a key pressed meanwhile waits for at
 * most one tab's build. */
function warmTabs(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const next = () => {
    const tab = TABS.map((t) => t.id).find((id) => id !== ui.state.activeTab && !warmed().has(id))
    if (!tab) return
    setWarmed(new Set([...warmed(), tab]))
    timer = setTimeout(next, 60)
  }
  timer = setTimeout(next, 250)
  return () => clearTimeout(timer)
}

function KeptTab(props: { id: TabId; children: (focused: () => SectionId) => JSX.Element }) {
  const active = () => ui.state.activeTab === props.id
  const [visited, setVisited] = createSignal(active())
  createEffect(() => { if (active() || warmed().has(props.id)) setVisited(true) })
  // Hidden, the tab keeps its last focus; built before its first visit (the
  // warm-up), it starts from the focus a switch gives it, so showing it
  // changes nothing that follows the focus.
  const focused = createMemo<SectionId>((was) => (active() ? ui.state.focusedSection : was), active() ? ui.state.focusedSection : TAB_DEFAULT_FOCUS[props.id])
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
