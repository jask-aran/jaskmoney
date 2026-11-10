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

export function afterPaint(fn: () => void): void {
  let done = false
  const run = () => { if (!done) { done = true; fn() } }
  renderer?.once("frame", () => setTimeout(run, 0))
  setTimeout(run, renderer ? 50 : 0)
}

let renderer: CliRenderer | null = null

function paintWith(r: CliRenderer): () => void {
  renderer = r
  return () => { if (renderer === r) renderer = null }
}

export function bootstrapper(setBootstrapped: Setter<boolean>) {
  return function bootstrap() {
    try {
      const demo = process.argv.includes("--demo")
      const demoReady = demo ? toggleDemo(ui, data) : Promise.resolve()
      const restored = restoreUiPrefs(data.state.uiPrefs, data.state.accounts, appNow(), data.cycle())
      ui.setTimeframe(restored.timeframe)
      ui.setDashChipCursor(activeChipIndex(restored.timeframe))
      data.setAccountSelection(restored.accountSelection)
      if (restored.chartViews) ui.setState({ chartViews: restored.chartViews })
      setBootstrapped(true)

      if (!demo) restingStatus(ui, data)
      if (process.argv.includes("--welcome") || (!demo && shouldWelcome(data))) openWelcome(ui)
      void demoReady.then(() => runSync(ui, data, { manual: false }))
      const timer = setInterval(() => void runSync(ui, data, { manual: false }), SYNC_INTERVAL_MS)
      onCleanup(() => clearInterval(timer))
      onCleanup(warmTabs())
    } catch (e) {
      ui.setStatus(`DB error: ${e instanceof Error ? e.message : String(e)}`, true)
    }
  }
}

export function startCore(remote: string | null, serving: string | null, bootstrap: () => void) {
  if (remote) {
    let quitting = false
    const link = wsLink(remote, { onClose: (reason) => { if (!quitting) ui.setStatus(`Lost the core: ${reason}`, true) } })
    onCleanup(() => { quitting = true; link.close() })
    data.connect(link)
    ui.setStatus("Connecting to the core…")
    return
  }
  try {
    traceMark("init start")
    data.init(process.env.JASKMONEY_DB)
    traceMark("database loaded")
    applyTheme(data.state.uiPrefs.theme)
    if (serving != null) {
      const { serveCore, DEFAULT_PORT } = require("../server/serve") as typeof import("../server/serve")
      const served = serveCore(data.core, { port: Number(serving) || DEFAULT_PORT })
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

export function startupEffects(remote: string | null, bootstrapped: Accessor<boolean>, bootstrap: () => void) {
  createEffect(() => {
    const none = data.state.ready && data.state.budgets.length === 0
    if (ui.state.budgetsEmpty !== none) ui.setState({ budgetsEmpty: none })
  })

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
    untrack(() => settleData(ui, data.saveUiPrefs(prefs, { soon: true })))
  })
}

export function syncClock(): () => string {
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

export function appInput(renderer: ReturnType<typeof useRenderer>) {
  useKeyboard((key: KeyEvent) => {
    if (key.ctrl && key.name === "c") {
      renderer.destroy()
      return
    }
    traceKey(key, ui.activeScope(), () => handleKey(ui, key, data))
  })
  traceFrames(renderer)
  onCleanup(paintWith(renderer))

  usePaste((event) => {
    if (handlePaste(ui, decodePasteBytes(event.bytes), data)) event.preventDefault()
  })
}

export function followEffects() {
  createEffect(on(() => ui.state.focusedSection === "bar.version", (on) => { if (on) void showVersion(ui) }, { defer: true }))

  createEffect(on(() => data.state.uiPrefs.theme, (id) => applyTheme(id), { defer: true }))
  createEffect(on(() => ui.state.themePicker == null, (closed) => { if (closed) applyTheme(data.state.uiPrefs.theme) }, { defer: true }))
}
