import { expect, test } from "bun:test"
import { cellsOf, flowBar, flowOpening, packLabels } from "./flow"
import type { Span } from "../primitives/spans"

const text = (spans: Span[]) => spans.map((s) => s.text).join("")
const label = (figure: string, name: string): Span[][] => [[{ text: figure, fg: "#fff", bold: true }, { text: ` ${name}`, fg: "#888" }], [{ text: figure, fg: "#fff", bold: true }]]

test("cells share the width out by running total: they always sum to it", () => {
  for (const amounts of [[1, 1, 1], [5, 0, 2.5, 7], [999, 1]]) expect(cellsOf(amounts, 51).reduce((n, c) => n + c, 0)).toBe(51)
  expect(cellsOf([0, 0], 10)).toEqual([0, 0])
})

test("labels slide apart over their parts before losing words; then a part thinner than its figure goes; then the smallest's words", () => {
  // Two parts of 10 cells, labels 16 wide: centred they'd overlap; slid,
  // both keep their words, each still over its part.
  const slid = text(packLabels(40, [{ from: 0, cells: 10, options: label("$1,000", "Groceries") }, { from: 10, cells: 10, options: label("$1,000", "Transport") }]))
  expect(slid).toMatch(/^\$1,000 Groceries {2}\$1,000 Transport$/)
  // Too many for the line: the optional one (thinner than its figure)
  // goes before anyone's words.
  const parts = [
    { from: 0, cells: 20, options: label("$2,000", "Good Life") },
    { from: 20, cells: 18, options: label("$1,800", "Home") },
    { from: 38, cells: 1, options: label("$50", "Fees"), optional: true },
  ]
  expect(text(packLabels(34, parts))).toMatch(/^ *\$2,000 Good Life {2,}\$1,800 Home *$/)
  // Narrower still: the smallest left loses its words first.
  expect(text(packLabels(26, parts))).toMatch(/^ *\$2,000 Good Life {2,}\$1,800 *$/)
})

test("a bar's labels may span columns of it: a total over several parts", () => {
  const { bar, labels } = flowBar(20, [{ amount: 1, color: "#a00" }, { amount: 1, color: "#0a0", hatch: true }], [{ cols: [0, 20], options: [[{ text: "$2 both", fg: "#fff" }]] }])
  expect(text(bar)).toBe("█".repeat(10) + "╱".repeat(10))
  expect(text(labels).trim()).toBe("$2 both")
})

test("an opening carries a part out to the full width: a corner where the part ends inside the bar, the edge where it reaches it", () => {
  const label: Span[] = [{ text: "50%", fg: "#fff" }]
  // The right end (savers): ╭──╯ from its start, the right edge down.
  const right = text(flowOpening(20, 8, 20, label))
  expect(right).toMatch(/^╭─{7}╯ +50% +│$/)
  // The left end (spending): the left edge down, ╰──╮ from its last cell.
  const left = text(flowOpening(20, 0, 8, label))
  expect(left).toMatch(/^│ +50% +╰─{11}╮$/)
  // The whole bar: both edges straight down.
  expect(text(flowOpening(20, 0, 20, label))).toMatch(/^│ +50% +│$/)
  for (const line of [right, left]) expect(line).toHaveLength(20)
  // Nothing to open (the part a cell at the end): a blank line.
  expect(text(flowOpening(20, 19, 20, label)).trim()).toBe("")
})
