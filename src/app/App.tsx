import { toggleDemo } from "./actions"
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
import { TagPicker } from "../ui/primitives/TagPicker"
import { OverviewTab } from "../ui/overview/OverviewTab"
import { ManagerTab } from "../ui/manager/ManagerTab"
import { SavedFilterPicker } from "../ui/manager/SavedFilterPicker"
import { SettingsTab, EditorOverlay, DryRunOverlay, AiDialog, UpAccountsDialog } from "../ui/settings/SettingsTab"
import { theme } from "../theme"
import { selectionLabel } from "../domain/accountTree"
import { SYNC_INTERVAL_MS, runSync, syncAgo } from "./sync"
import { activeChipIndex } from "../domain/timeframe"
import type { UiPrefs } from "../state/settingsConfig"
import { restoreUiPrefs } from "../state/uiPrefs"


export function App() {
  const renderer = useRenderer()

  const [bootstrapped, setBootstrapped] = createSignal(false)
  // The same array until the palette reopens or its query changes (keys'
  // paletteList), so a cursor move leaves the palette's rows alone.
  const paletteCommands = createMemo(() => ui.state.palette ? paletteList(ui, data) : [])

  onMount(() => {
    try {
      const path = process.env.JASKMONEY_DB
      data.init(path)
      if (process.env.JASKMONEY_NO_BOOTSTRAP === "1") {
        ui.setStatus("OpenTUI shell · bootstrap off")
        return
      }
      // `jaskmoney --demo` opens straight into demo mode (your data untouched).
      const demo = process.argv.includes("--demo")
      if (demo) toggleDemo(ui, data)
      const restored = restoreUiPrefs(data.state.uiPrefs, data.state.accounts, appNow(), data.cycle())
      ui.setTimeframe(restored.timeframe)
      ui.setDashChipCursor(activeChipIndex(restored.timeframe))
      data.setAccountSelection(restored.accountSelection)
      if (restored.chartViews) ui.setState({ chartViews: restored.chartViews })
      setBootstrapped(true)

      if (demo) {
        // toggleDemo's status says what demo mode is.
      } else if (data.state.transactions.length > 0) {
        ui.setStatus(`${data.state.transactions.length} transactions loaded.`)
      } else {
        ui.setStatus("No transactions yet · Settings → Database & Import → i to import")
      }
      // Sync now, then on an interval; ctrl+r syncs on demand.
      void runSync(ui, data, { manual: false })
      const timer = setInterval(() => void runSync(ui, data, { manual: false }), SYNC_INTERVAL_MS)
      onCleanup(() => clearInterval(timer))
    } catch (e) {
      ui.setStatus(`DB error: ${e instanceof Error ? e.message : String(e)}`, true)
    }
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
    untrack(() => data.saveUiPrefs(prefs, { soon: true }))
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
        accountLabel={[data.state.demo ? "DEMO" : "", accountLabel(), data.state.demo ? "" : syncLabel()].filter(Boolean).join(" · ")}
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
      <AiDialog />
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
    <box border borderStyle="rounded" borderColor={theme.error} paddingLeft={1} paddingRight={1} flexDirection="column">
      <text fg={theme.error}>
        <b>This tab failed to render</b>
      </text>
      <text fg={theme.text}>{message()}</text>
      <text fg={theme.overlay1}>Switch tabs to retry · ctrl+c quits</text>
    </box>
  )
}
