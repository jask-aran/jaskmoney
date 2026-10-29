// First: the stores read keys and settings as their modules load.
import "./startup"
import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import { App } from "./app/App"
import { stopDaemonSync } from "./ai/executor"

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
// jaskmoney's own Executor daemon (ai/executor) runs only while the app does.
process.on("exit", stopDaemonSync)
for (const signal of ["SIGTERM", "SIGHUP"] as const) process.on(signal, () => process.exit(0))
process.on("uncaughtException", fatal)
process.on("unhandledRejection", fatal)

await render(() => <App />, renderer)
