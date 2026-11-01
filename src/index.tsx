// First: the stores read keys and settings as their modules load.
import "./startup"
import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import { App } from "./app/App"
import { ui } from "./state/uiStore"
import { data } from "./state/dataStore"
import { watchRowLifetimes } from "./state/rowLifetimes"
import { traceMark } from "./app/trace"
import { APP_CHART_MS, chartMotion } from "./ui/charts/motion"

traceMark("modules loaded")

// Charts draw themselves in on a new view, briefly (tests leave it at 0).
chartMotion.ms = APP_CHART_MS

const stopRowLifetimes = watchRowLifetimes(ui, data)
process.on("exit", stopRowLifetimes)

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  targetFps: 30,
  // Use terminal size; captures target 140×44 when resized
})

// An error that escapes rendering must not leave the terminal in raw mode
// with the enhanced keyboard protocol on (Ctrl-C then stops working). Restore
// the terminal first, then report and exit.
function fatal(error: unknown): void {
  try { renderer.destroy() } catch { /* already torn down */ }
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  process.exit(1)
}
process.on("uncaughtException", fatal)
process.on("unhandledRejection", fatal)

traceMark("renderer created")
await render(() => <App />, renderer)
traceMark("app mounted")
