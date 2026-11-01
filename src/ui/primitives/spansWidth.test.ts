import { expect, test } from "bun:test"
import { truncate } from "../text"
import { fitSpans, spansWidth } from "./spans"
import { ink } from "../../theme"

test("C3.9 span truncation keeps wide glyphs and emoji within the cell budget", () => {
  for (const text of ["界界界界", "🏖️🏖️🏖️", "👩‍👩‍👧‍👦 family", "e\u0301e\u0301界"]) {
    for (let budget = 0; budget <= Bun.stringWidth(text) + 2; budget++) {
      const spans = fitSpans([{ text: "x", fg: ink.note }, { text, fg: ink.figure, bold: true }], budget)
      expect(spansWidth(spans)).toBeLessThanOrEqual(budget)
      if (budget > 1 && Bun.stringWidth(text) > budget - 1) expect(spans[1]).toEqual({ text: truncate(text, budget - 1), fg: ink.figure, bold: true })
    }
  }
  expect(fitSpans([{ text: "界", fg: ink.figure }], -1)).toEqual([])
  expect(truncate("界", 0)).toBe("")
  expect(truncate("🏖️", -1)).toBe("")
  expect(truncate("👩‍👩‍👧‍👦 family", 3)).toBe("👩‍👩‍👧‍👦…")
})
