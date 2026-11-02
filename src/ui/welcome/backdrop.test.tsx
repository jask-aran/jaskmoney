import { expect, onTestFinished, spyOn, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { renderApp } from "../../testing/app"
import { key } from "../../testing/keys"
import { handleKey } from "../../app/keys"
import { openWelcome, sources } from "../../app/welcome"
import type { StyledSpan } from "../primitives/StyledLine"
import { backdropLines, keepSameLines, type BackdropId } from "./backdrop"
import { BACKDROP_INK } from "./Welcome"

/**
 * The welcome page's backdrops, frozen as they were drawn before they were
 * made cheap enough for 25-30 frames a second (2026-11-02: per-cell colour
 * mixing and per-cell ticker text took most of a core): the same marks, the
 * same colours, the same motion. Then the screen: what the setup draws
 * behind its card is those lines, cell for cell (OpenTUI's captured buffer).
 */
const ink = { level: (l: number) => `#10101${l}`, up: "#00ff00", down: "#ff0000" }
test("a frame keeps the lines that didn't change, and is the last frame when none did", () => {
  const a = backdropLines("ticker", 80, 12, 20, ink)
  // A tape moves at 2-11 columns a second: a few ms on, nothing has moved.
  expect(keepSameLines(a, backdropLines("ticker", 80, 12, 20.001, ink))).toBe(a)
  const b = keepSameLines(a, backdropLines("ticker", 80, 12, 21, ink))
  expect(b).not.toBe(a)
  // The blank rows are the same lines; the tapes that moved are new.
  expect(b[0]).toBe(a[0]!)
  expect(b[1]).not.toBe(a[1]!)
  expect(b.map((l) => l.map((s) => s.text).join(""))).toEqual(backdropLines("ticker", 80, 12, 21, ink).map((l) => l.map((s) => s.text).join("")))
  // A screen of another size is all new lines.
  expect(keepSameLines(a, backdropLines("ticker", 80, 13, 21, ink)).length).toBe(13)
})

test("drawn: behind the setup, each backdrop's cells are its lines, character and colour", async () => {
  // The setup's clock reads performance.now(): held, then moved on by hand.
  let clock = 5_000_000
  const now = spyOn(performance, "now").mockImplementation(() => clock)
  const tickers = spyOn(sources, "tickers").mockResolvedValue(null)
  onTestFinished(() => { now.mockRestore(); tickers.mockRestore() })
  const t = await renderApp({ width: 100, height: 30 })
  openWelcome(ui)
  await t.renderOnce()
  // Ten seconds on, the clock's next step draws the tape ten seconds in.
  clock += 10_000
  await new Promise((resolve) => setTimeout(resolve, 120))
  await t.renderOnce()
  const cells = (spans: Array<{ text: string; fg: string | RGBA }>) =>
    spans.flatMap((s) => [...s.text].map((ch) => `${ch}${(typeof s.fg === "string" ? RGBA.fromHex(s.fg) : s.fg).toInts().join(",")}`))
  const expectRows = (id: BackdropId, seconds: number) => {
    const want = backdropLines(id, 100, 28, seconds, BACKDROP_INK)
    const got = t.captureSpans().lines
    // Rows 0-5: above the title (the card and title sit centred over the rest).
    for (const y of [0, 1, 2, 5]) expect(cells(got[y]!.spans)).toEqual(cells(want[y]! as StyledSpan[] as Array<{ text: string; fg: string }>))
  }
  expectRows("ticker", 10)
  expect(t.captureSpans().lines[1]!.spans.map((s) => s.text).join("")).toMatch(/[A-Z\d]+ [\d,.]+ [▲▼]/)
  // b tries the next: plasma, from its beginning, then the coin rain.
  handleKey(ui, key("b"), data)
  await t.renderOnce()
  expectRows("plasma", 0)
  clock += 2_500
  await new Promise((resolve) => setTimeout(resolve, 120))
  await t.renderOnce()
  expectRows("plasma", 2.5)
  handleKey(ui, key("b"), data)
  clock += 4_000
  await new Promise((resolve) => setTimeout(resolve, 120))
  await t.renderOnce()
  expectRows("coins", 4)
  ui.switchTab("overview")
})

test("the card's rows are kept by place as it's rebuilt (the caret blinks): a click still does its row", async () => {
  const tickers = spyOn(sources, "tickers").mockResolvedValue(null)
  onTestFinished(() => tickers.mockRestore())
  const t = await renderApp({ width: 130, height: 44 })
  openWelcome(ui)
  await t.renderOnce()
  const clickRow = async (label: string) => {
    const lines = t.captureCharFrame().split("\n")
    const y = lines.findIndex((l) => l.includes(label))
    await t.mockMouse.click(lines[y]!.indexOf(label), y)
  }
  await clickRow("Skip the tour")
  expect(ui.state.welcome?.step).toBe("up")
  await t.renderOnce()
  const caret = () => t.captureCharFrame().match(/Token {2}(.)paste it here/)![1]
  const before = caret()
  // The caret blinks every 6 ticks (480 ms): the column is rebuilt under it.
  await new Promise((resolve) => setTimeout(resolve, 560))
  await t.renderOnce()
  expect(caret()).not.toBe(before)
  await clickRow("Skip: connect Up later")
  expect(ui.state.welcome?.step).toBe("ai")
  ui.switchTab("overview")
})
