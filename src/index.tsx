import { createCliRenderer } from "@opentui/core"
import { render } from "@opentui/solid"
import { App } from "./app/App"

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

await render(() => <App />, renderer)
