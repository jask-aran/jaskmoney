import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { theme } from "../../theme"
import { UP_LOGO_WIDTH } from "./UpLogo"

const W = 120
const ints = (hex: string) => RGBA.fromHex(hex).toInts()

/** The cell at column x of a captured line: its glyph, ink and paper. */
function cellAt(line: { spans: { text: string; fg: RGBA; bg: RGBA }[] }, x: number) {
  let col = 0
  for (const span of line.spans) {
    for (const ch of span.text) {
      if (col === x) return { ch, fg: span.fg.toInts(), bg: span.bg.toInts() }
      col++
    }
  }
  throw new Error(`no cell at ${x}`)
}

test("the Up mark fills the Overview's top-right corner; the tab bar and Date Range end short of it", async () => {
  const t = await renderApp({ width: W, height: 40 })
  data.init(":memory:")
  ui.switchTab("overview")
  await t.renderOnce()
  const lines = t.captureSpans().lines
  const left = W - UP_LOGO_WIDTH
  // The apex on the tab bar's row, its paper the tab bar's own.
  expect(cellAt(lines[0]!, left + 5)).toEqual({ ch: "▟", fg: ints("#ffe94f"), bg: ints(theme.mantle) })
  // The "u" and "p" in coral on the yellow, and the base on the canvas.
  expect(cellAt(lines[2]!, left + 1)).toEqual({ ch: "▟", fg: ints("#ff7461"), bg: ints(theme.canvas) })
  expect(cellAt(lines[3]!, left + 6)).toEqual({ ch: "▐", fg: ints("#ff7461"), bg: ints("#ffe94f") })
  expect(cellAt(lines[4]!, left + 0)).toEqual({ ch: "▗", fg: ints("#ffe94f"), bg: ints(theme.canvas) })
  // The Date Range card's right edge stops one column before the mark.
  const frame = t.captureCharFrame().split("\n")
  expect(frame[2]![left - 2]).toBe("╮")
  expect(frame[4]![left - 2]).toBe("╯")
  // Other tabs have no mark and the full-width tab bar.
  ui.switchTab("manager")
  await t.renderOnce()
  expect(t.captureCharFrame().split("\n")[0]!).not.toContain("▟")
  t.renderer.destroy()
})
