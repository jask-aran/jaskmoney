import { expect, onTestFinished, test } from "bun:test"
import { RGBA, TextAttributes } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import type { Command } from "../../app/commands"
import { ink, theme } from "../../theme"
import { visibleWindow } from "./listWindow"
import { CommandPalette } from "./CommandPalette"

test("C3.10 cumulative window contains the full cursor entry within its height budget", () => {
  expect(visibleWindow([], 0, 6)).toEqual({ start: 0, end: 0 })
  for (const heights of [[1, 1, 1], [1, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1], [2, 7, 2]]) {
    for (let cursor = 0; cursor < heights.length; cursor++) {
      for (const rows of [0, 1, 3, 6, 20]) {
        const { start, end } = visibleWindow(heights, cursor, rows)
        expect(start).toBeLessThanOrEqual(cursor)
        expect(end).toBeGreaterThan(cursor)
        expect(heights.slice(start, end).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(Math.max(1, rows, heights[cursor]!))
      }
    }
  }
})

test("C3.10 six one-command groups keep every cursor visible with the correct cell styles", async () => {
  const commands: Command[] = Array.from({ length: 6 }, (_, i) => ({ id: `test-${i}`, label: `Command ${i}`, category: `Group ${i}`, run: () => {} }))
  const [cursor, setCursor] = createSignal(0)
  const t = await testRender(() => <CommandPalette commands={commands} cursor={cursor()} query="" lastId={null} />, { width: 80, height: 20 })
  onTestFinished(() => t.renderer.destroy())
  const ints = (color: string) => RGBA.fromHex(color).toInts()
  for (const index of [0, 1, 2, 3, 4, 5, 4, 3, 2, 1, 0]) {
    setCursor(index)
    await t.renderOnce()
    const cells = t.captureSpans().lines.flatMap((line) => line.spans)
    const at = cells.find((span) => span.text === `Command ${index}`)
    expect(at).toBeDefined()
    expect(at!.fg.toInts()).toEqual(ints(ink.figure))
    expect(at!.bg.toInts()).toEqual(ints(theme.rowCursor))
    expect(at!.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
    for (const span of cells.filter((span) => /^Command \d$/.test(span.text) && span.text !== `Command ${index}`)) {
      expect(span.bg.toInts()).toEqual(ints(theme.mantle))
      expect(span.attributes & TextAttributes.BOLD).toBe(0)
    }
  }
})
