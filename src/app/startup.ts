import { showVersion, handleKey, handlePaste } from "./keys"
import { openWelcome, restingStatus, shouldWelcome } from "./welcome"
import { traceFrames, traceKey, traceMark } from "./trace"
import { settleData, toggleDemo } from "./actions"
import { createEffect, createSignal, untrack, on, onCleanup, type Accessor, type Setter } from "solid-js"
import { usePaste, useKeyboard, type useRenderer } from "@opentui/solid"
import { decodePasteBytes, type KeyEvent, type CliRenderer } from "@opentui/core"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { appNow } from "../domain/days"
import { applyTheme } from "../theme"
import { SYNC_INTERVAL_MS, runSync } from "./sync"
import { syncAgo } from "../domain/days"
import { activeChipIndex } from "../domain/timeframe"
import type { UiPrefs } from "../state/settingsConfig"
import { restoreUiPrefs } from "../state/uiPrefs"
import { wsLink } from "../client/wsLink"
import { warmTabs } from "./KeptTab"

/**
 * Run `fn` once the frame the current key asked for is on screen: work a
 * key sets off but its frame doesn't need (background suggesting, lookups)
 * waits for it rather than holding it up. Without a renderer (tests), or
 * if no frame comes within 50 ms, it runs on a timer.
 */
export function afterPaint(fn: () => void): void {
  let done = false
  const run = () => { if (!done) { done = true; fn() } }
  renderer?.once("frame", () => setTimeout(run, 0))
  setTimeout(run, renderer ? 50 : 0)
}

let renderer: CliRenderer | null = null

/** App start: frames come from this renderer. Returns the undo. */
function paintWith(r: CliRenderer): () => void {
  renderer = r
  return () => { if (renderer === r) renderer = null }
}

/** App's start once the core's data is in: the saved range and accounts,
 * the welcome, the sync timer and the tabs' warm-up. */
export function bootstrapper(setBootstrapped: Setter<boolean>) {
  return function bootstrap() {
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
}

/** The core: a remote one's link, or this process's database (served with
 * `--serve`), then the start. */
export function startCore(remote: string | null, serving: string | null, bootstrap: () => void) {
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
    // Before the first draw, so a chosen theme never flashes the default.
    applyTheme(data.state.uiPrefs.theme)
    if (serving != null) {
      const { serveCore, DEFAULT_PORT } = require("../server/serve") as typeof import("../server/serve")
      // The core then broadcasts where it serves and who is connected.
      const served = serveCore(data.core, { port: Number(serving) || DEFAULT_PORT })
      // A listening server would keep the process alive after quitting.
      onCleanup(() => served.stop())
      ui.setStatus(`Serving the core at ${served.api}`)
    }
  } catch (e) {
    ui.setStatus(`DB error: ${e instanceof Error ? e.message : String(e)}`, true)
    return
  }
  if (process.env.JASKMONEY_NO_BOOTSTRAP === "1") {
    ui.setStatus("Bootstrap off")
    return
  }
  bootstrap()
}

/** The effects that follow the data after the start: the Budgets tab's
 * empty flag, a remote core's late start, and the saved UI prefs. */
export function startupEffects(remote: string | null, bootstrapped: Accessor<boolean>, bootstrap: () => void) {
  // With no budgets yet, the Budgets tab opens on Set budgets (switchTab).
  createEffect(() => {
    const none = data.state.ready && data.state.budgets.length === 0
    if (ui.state.budgetsEmpty !== none) ui.setState({ budgetsEmpty: none })
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
      chartViews: [...ui.state.chartViews],
    }
    // Written once keys settle: these change on every [ ] d a h l.
    untrack(() => settleData(ui, data.saveUiPrefs(prefs, { soon: true })))
  })
}

/** The top bar's sync label, kept current. */
export function syncClock(): () => string {
  // Re-render the "synced Xm ago" label every 30 seconds.
  const [now, setNow] = createSignal(Date.now())
  const tick = setInterval(() => setNow(Date.now()), 30_000)
  onCleanup(() => clearInterval(tick))
  const syncLabel = () => {
    if (data.state.upSyncing) return "syncing…"
    const ago = syncAgo(data.state.dbInfo?.upLastSyncedAt ?? null, now())
    return ago ? `synced ${ago}` : ""
  }
  return syncLabel
}

/** Keys and pastes into the app, and the renderer's frame hooks. */
export function appInput(renderer: ReturnType<typeof useRenderer>) {
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
    if (handlePaste(ui, decodePasteBytes(event.bytes), data)) event.preventDefault()
  })
}

/** The version check on the bar's cursor, and the theme following its pref
 * and picker. */
export function followEffects() {
  // The cursor on the top bar's version checks for a newer one, as
  // pointing at it with the mouse does.
  createEffect(on(() => ui.state.focusedSection === "bar.version", (on) => { if (on) void showVersion(ui) }, { defer: true }))

  // A theme change (Settings › Appearance › Theme) redraws everything: the
  // view tree remounts on it, reading the new colours. State lives in the
  // stores, so the tabs come back as they were.
  createEffect(on(() => data.state.uiPrefs.theme, (id) => applyTheme(id), { defer: true }))
  // The theme picker shows the theme at its cursor; closed (esc, a tab
  // switch) without keeping one, the saved theme comes back.
  createEffect(on(() => ui.state.themePicker == null, (closed) => { if (closed) applyTheme(data.state.uiPrefs.theme) }, { defer: true }))
}
