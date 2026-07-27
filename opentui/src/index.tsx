import { render } from "@opentui/solid"
import { App } from "./app/App"

await render(() => <App />, {
  exitOnCtrlC: true,
  targetFps: 30,
  // Use terminal size; captures target 140×44 when resized
})
