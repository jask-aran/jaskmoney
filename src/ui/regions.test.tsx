import { expect, test } from "bun:test"
import { createSignal } from "solid-js"
import { testRender } from "@opentui/solid"
import { regionRef, regionRects } from "./regions"

test("regions use absolute screen cells and exclude invisible ancestors ", async () => {
  const [visible, setVisible] = createSignal(true)
  const t = await testRender(() => <box left={7} top={3} width={40} height={12}>
    <box visible={visible()} left={2} top={1} width={20} height={6}>
      <box ref={regionRef("ov.chart", "overview")} left={3} top={2} width={9} height={2} />
    </box>
    <text ref={regionRef("bar.web", "bar")} width={8} height={1}>web app</text>
  </box>, { width: 80, height: 24 })
  try {
    await t.renderOnce()
    const rects = regionRects("overview")
    expect(rects.find((r) => r.id === "ov.chart")?.rect).toEqual({ x: 12, y: 6, width: 9, height: 2 })
    expect(rects.some((r) => r.id === "bar.web")).toBe(true)
    expect(regionRects("manager").some((r) => r.id === "ov.chart")).toBe(false)
    setVisible(false)
    await t.renderOnce()
    expect(regionRects("overview").filter((r) => r.id === "ov.chart")).toEqual([])
    setVisible(true)
    await t.renderOnce()
    expect(regionRects("overview").some((r) => r.id === "ov.chart")).toBe(true)
  } finally { t.renderer.destroy() }
  expect(regionRects("overview")).toEqual([])
})

test("cleanup of an older region leaves its replacement registered", async () => {
  const first = await testRender(() => <box ref={regionRef("ov.chart", "overview")} width={10} height={2} />, { width: 80, height: 24 })
  const second = await testRender(() => <box ref={regionRef("ov.chart", "overview")} width={20} height={3} />, { width: 80, height: 24 })
  try {
    await first.renderOnce()
    await second.renderOnce()
    first.renderer.destroy()
    expect(regionRects("overview").find((r) => r.id === "ov.chart")?.rect.width).toBe(20)
  } finally { second.renderer.destroy(); first.renderer.destroy() }
  expect(regionRects("overview")).toEqual([])
})
