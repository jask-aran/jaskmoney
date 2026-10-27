import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { theme } from "../../theme"
import { ChartBody, type ChartModel } from "./ChartBody"

/** Chart rows are StyledText set on the node (not a span per run): prove the
 * cells' colours, including a run losing its ink on the next model. */
test("chart rows paint each run's ink, the default where none, and clear an ink that goes", async () => {
  const red = "#ff0000"
  const model = (ink: string | null): ChartModel => ({
    rows: [[{ text: "ab", ink }, { text: "cd", ink: null }]],
    ticks: new Map([[0, "$1"]]),
    labels: "lbl",
    legend: [],
  })
  const [current, setCurrent] = createSignal(model("x"))
  const t = await testRender(() => <box flexDirection="column"><ChartBody model={current()} inks={{ x: red }} /></box>, { width: 20, height: 4 })
  try {
    await t.renderOnce()
    const cells = () => t.captureSpans().lines[0]!.spans
    const span = (text: string) => cells().find((s) => s.text.includes(text))!
    expect(t.captureCharFrame()).toContain("$1 ┤abcd")
    expect(span("$1").fg.toInts()).toEqual(RGBA.fromHex(theme.overlay1).toInts())
    expect(span("ab").fg.toInts()).toEqual(RGBA.fromHex(red).toInts())
    const plain = span("cd").fg.toInts()
    expect(plain).not.toEqual(RGBA.fromHex(red).toInts())
    setCurrent(model(null))
    await t.renderOnce()
    expect(span("ab").fg.toInts()).toEqual(plain)
  } finally { t.renderer.destroy() }
})
