import "./cli"
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

armLaunchReveal()

const stopRowLifetimes = watchRowLifetimes(ui, data)
process.on("exit", stopRowLifetimes)

const renderer = await createCliRenderer({
  exitOnCtrlC: false,
  targetFps: 30,
})

function fatal(error: unknown): void {
  try { renderer.destroy() } catch {}
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  process.exit(1)
}
process.on("uncaughtException", fatal)
process.on("unhandledRejection", fatal)

renderer.setMaxListeners(64)

traceMark("renderer created")
await render(() => <App />, renderer)
traceMark("app mounted")

watchForUpdates()
