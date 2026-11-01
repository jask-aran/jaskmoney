import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createStore } from "solid-js/store"
import { ChartBody, type ChartModel } from "./ChartBody"

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
