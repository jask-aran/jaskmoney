import { expect, test } from "bun:test"
import { categoryBar, netBar, sourcesBars } from "./RangeGraphics"
import type { Span } from "../primitives/spans"

const text = (spans: Span[]) => spans.map((s) => s.text).join("")
const W = 40

test("spending more than came in, sources past the gap cover only the gap, shared by their sizes; none from Spending's balance", () => {
  // $1,000 in, $1,300 spent: Rainy day's $900 drawn on covers just the $300.
  const [above] = sourcesBars(W, 1000, 1300, [{ amount: 900, color: "#0af", name: "Rainy day", figure: "#0af" }])
  expect(text(above!)).toMatch(/\$1,000 in\s+\$300 Rainy day/)
  expect(text(above!)).not.toMatch(/other|Spending/)
})

test("sources short of the gap: the rest is other, never guessed at", () => {
  const [above] = sourcesBars(W, 1000, 1600, [{ amount: 400, color: "#0af", name: "Holiday", figure: "#0af" }])
  expect(text(above!)).toMatch(/\$1,000 in\s+\$400 Holiday\s+\$200( other)?/)
})

test("nothing in: the spending all hatched, under all its sources", () => {
  const lines = sourcesBars(W, 0, 500, [{ amount: 500, color: "#0af", name: "transfers", figure: "#0af" }])
  expect(text(lines[3]!)).toBe("╱".repeat(W))
  expect(text(lines[0]!)).toMatch(/\$500 transfers/)
  expect(text(lines[4]!)).toMatch(/\$500 spent/)
})

test("with where the spending went, a third bar of the same width under the spending, the spent and net figures inside the edges", () => {
  const lines = sourcesBars(W, 1000, 1600, [], [{ amount: 1200, color: "#a6e3a1", name: "Groceries" }, { amount: 400, color: "#fab387", name: "Fuel" }])
  expect(lines).toHaveLength(7)
  expect(text(lines[4]!)).toMatch(/^│ .*\$1,600 spent\s+-\$600 net.* │$/)
  expect(text(lines[5]!)).toHaveLength(W)
  expect(text(lines[6]!)).toMatch(/\$1,200 Groceries\s+\$400 Fuel/)
})

test("where the net went: savers' gains largest first, then what stayed in Spending as kept; losses aren't parts", () => {
  const { labels } = netBar(W, 1000, [{ name: "Small", change: 100, color: "#0af" }, { name: "Big", change: 500, color: "#fa0" }, { name: "Down", change: -50, color: "#f00" }])
  expect(text(labels)).toMatch(/\$500 Big\s+\$100( Small)?\s+\$400 kept/)
  expect(text(labels)).not.toContain("Down")
})

test("where the spending went: every category group named where it fits, largest first", () => {
  const { labels } = categoryBar(W, [{ amount: 100, color: "#0af", name: "Fuel" }, { amount: 300, color: "#fa0", name: "Groceries" }])
  expect(text(labels)).toMatch(/\$300 Groceries\s+\$100 Fuel/)
})
