import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { RGBA } from "@opentui/core"
import { createStore } from "solid-js/store"
import { ink } from "../../theme"
import { ChartBody, axisWidth, type ChartModel } from "./ChartBody"

const model: ChartModel = { rows: [[{ text: "⣀".repeat(16), ink: "spend" }]], ticks: new Map(), labels: "", legend: [] }
const dots = (frame: string) => [...frame].filter((c) => c === "⣀").length
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// The Overview's two panes take their keys from one store array: switching
// one pane's view replaces it. The other pane's key reads the same, and its
// chart must not draw in again.
test("a chart draws in when its key changes, not when it's read again unchanged", async () => {
  const [views, setViews] = createStore({ list: ["Daily", "Available"] })
  const t = await testRender(() => <ChartBody model={model} inks={{ spend: "#ffffff" }} revealKey={views.list[1]} revealMs={60} />, { width: 30, height: 3 })
  await wait(150)
  await t.renderOnce()
  expect(dots(t.captureCharFrame())).toBe(16)
  setViews("list", ["Weekly", "Available"])
  await wait(20)
  await t.renderOnce()
  expect(dots(t.captureCharFrame())).toBe(16)
  setViews("list", ["Weekly", "Savers"])
  await wait(20)
  await t.renderOnce()
  expect(dots(t.captureCharFrame())).toBeLessThan(16)
  t.renderer.destroy()
})

// Each cell's colour from the cell buffer: a run's ink through the model's
// own inks first, then the shared ones, then figure; mid draw-in, a hidden
// line leaves its column's gridline standing in the gridline's ink, and
// the labels still wait.
test("a chart's cells take their inks, and a draw-in leaves the gridlines in theirs", async () => {
  const lined: ChartModel = {
    rows: [
      [{ text: "⣀⣀", ink: "own" }, { text: "│", ink: "grid" }, { text: "⣀⣀", ink: "spend" }, { text: "⣀", ink: "unknown" }],
      [{ text: "▄▄", ink: "spend" }, { text: "│", ink: "grid" }, { text: " high", ink: "spend" }],
    ],
    ticks: new Map([[0, "$5"]]), labels: "", legend: [], inks: { own: "#00ff00" },
  }
  const inks = { spend: "#ffffff", grid: "#444444", own: "#ff0000" }
  const colourAt = (t: Awaited<ReturnType<typeof testRender>>, y: number, x: number) => {
    let col = 0
    for (const span of t.captureSpans().lines[y]!.spans) {
      for (const ch of span.text) { if (col === x) return { ch, fg: span.fg.toInts() }; col++ }
    }
    return undefined
  }
  const axis = axisWidth(lined.ticks) // "$5" padded to the axis's least label width, then " ┤"
  const whole = await testRender(() => <ChartBody model={lined} inks={inks} />, { width: 20, height: 3 })
  await whole.renderOnce()
  expect(colourAt(whole, 0, axis)).toEqual({ ch: "⣀", fg: RGBA.fromHex("#00ff00").toInts() })
  expect(colourAt(whole, 0, axis + 2)).toEqual({ ch: "│", fg: RGBA.fromHex("#444444").toInts() })
  expect(colourAt(whole, 0, axis + 3)).toEqual({ ch: "⣀", fg: RGBA.fromHex("#ffffff").toInts() })
  expect(colourAt(whole, 0, axis + 5)).toEqual({ ch: "⣀", fg: RGBA.fromHex(ink.figure).toInts() })
  expect(colourAt(whole, 1, axis + 4)).toEqual({ ch: "h", fg: RGBA.fromHex("#ffffff").toInts() })
  whole.renderer.destroy()

  // A long draw-in, a tick in: the line's first column at most, the
  // gridlines, no label.
  const drawing = await testRender(() => <ChartBody model={lined} inks={inks} revealKey="a" revealMs={60_000} />, { width: 20, height: 3 })
  await wait(60)
  await drawing.renderOnce()
  expect(colourAt(drawing, 0, axis + 1)?.ch).toBe(" ")
  expect(colourAt(drawing, 0, axis + 2)).toEqual({ ch: "│", fg: RGBA.fromHex("#444444").toInts() })
  expect(colourAt(drawing, 1, axis + 2)).toEqual({ ch: "│", fg: RGBA.fromHex("#444444").toInts() })
  expect(colourAt(drawing, 1, axis + 4)?.ch).toBe(" ")
  drawing.renderer.destroy()
})

test("the y-axis keeps one width for the usual money labels, so gridlines stay put across views", () => {
  const width = (...labels: string[]) => axisWidth(new Map(labels.map((l, i) => [i, l])))
  expect(new Set([width("$0", "$5"), width("$500", "$1k"), width("$10k", "$5k"), width("$2.5k", "-$500")]).size).toBe(1)
  // Its widest usual label sits where a Calendar's weekdays do; a longer one widens it.
  expect(width("$2.5k")).toBe("$2.5k ┤".length)
  expect(width("-$1.5k")).toBeGreaterThan(width("$10k"))
})
