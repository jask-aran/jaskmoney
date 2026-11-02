// First: `jaskmoney upgrade` and --version run instead of the app.
import "./cli"
// Then: the stores read keys and settings as their modules load.
import "./startup"
import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import { App } from "./app/App"
import { ui } from "./state/uiStore"
import { data } from "./state/dataStore"
import { watchRowLifetimes } from "./state/rowLifetimes"
import { traceMark } from "./app/trace"
import { armLaunchReveal } from "./ui/charts/motion"
import { watchForUpdates } from "./app/updates"

traceMark("modules loaded")

// The Overview's charts draw themselves in once, as they first show data.
armLaunchReveal()

const stopRowLifetimes = watchRowLifetimes(ui, data)
process.on("exit", stopRowLifetimes)

const renderer = await createCliRenderer({
  // ctrl+c is App's (its key handler quits, and the key goes no further):
  // the renderer's own would quit too, a tick after the key also reached
  // handleKey (a "c" in Transactions opens the category picker).
  exitOnCtrlC: false,
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

// Every component that follows the terminal's size listens for resize, and
// the tabs stay mounted: a dozen or so at once is normal, not a leak (each
// is removed with its component). Above Node's default warning at 10.
renderer.setMaxListeners(64)

traceMark("renderer created")
await render(() => <App />, renderer)
traceMark("app mounted")

// Whether a newer release is out, now and every 10 minutes (the top bar's version says).
watchForUpdates()
