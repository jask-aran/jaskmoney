import { onTestFinished } from "bun:test"
import { testRender } from "@opentui/solid"
import { App } from "../app/App"
import { testEnv } from "./scoped"

type Rendered = Awaited<ReturnType<typeof testRender>>

export async function renderApp(options: { width: number; height: number }): Promise<Rendered> {
  let rendered: Rendered | undefined
  onTestFinished(() => {
    try { rendered?.renderer.destroy() } catch {}
  })
  testEnv("JASKMONEY_DB", ":memory:")
  testEnv("JASKMONEY_NO_BOOTSTRAP", "1")
  rendered = await testRender(() => <App />, options)
  return rendered
}
