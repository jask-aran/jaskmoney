import { onTestFinished } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../app/App"
import { testEnv } from "./scoped"

type Rendered = Awaited<ReturnType<typeof testRender>>

/** Mount <App /> on an in-memory database with bootstrap off. Nothing is
 * rendered or flushed here. When the test finishes (after afterEach, pass or
 * fail) the renderer is destroyed, then the environment it set is restored:
 * a test that fails before its own destroy() would otherwise leave the App
 * mounted on the shared stores, where later store writes drive its effects
 * into a loop. */
export async function renderApp(options: { width: number; height: number }): Promise<Rendered> {
  let rendered: Rendered | undefined
  onTestFinished(() => {
    try { rendered?.renderer.destroy() } catch { /* already destroyed */ }
  })
  testEnv("JASKMONEY_DB", ":memory:")
  testEnv("JASKMONEY_NO_BOOTSTRAP", "1")
  rendered = await testRender(() => <App />, options)
  return rendered
}
