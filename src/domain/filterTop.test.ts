import { expect, test } from "bun:test"
import { applyTop, evalFilter, notForRules, parseFilter, parseFilterStrict } from "./filter"
import { transaction } from "../testing/fixtures"

const rows = [
  transaction({ id: 1, amount: -5, description: "KFC", dateISO: "2026-10-01" }),
  transaction({ id: 2, amount: -80, description: "Coles", dateISO: "2026-10-02" }),
  transaction({ id: 3, amount: 120, description: "Refund", dateISO: "2026-10-03" }),
  transaction({ id: 4, amount: -80, description: "Coles", dateISO: "2026-10-04" }),
  transaction({ id: 5, amount: -9, description: "McDonald's", dateISO: "2026-10-05" }),
]
const run = (expr: string) => {
  const { node } = parseFilterStrict(expr)
  return applyTop(node, rows.filter((t) => evalFilter(node, t))).map((t) => t.id)
}

test("top:N keeps the N biggest of what the rest matches, either direction, ties the newest; order kept", () => {
  expect(run("top:2")).toEqual([3, 4])
  expect(run("amt:<0 top:2")).toEqual([2, 4])
  expect(run("desc:kfc OR desc:mcdonalds")).toEqual([1, 5])
  expect(run("(desc:kfc OR desc:mcdonalds) top:1")).toEqual([5])
})

test("top: only at the top level, once, as a whole number; never in a rule", () => {
  for (const bad of ["top:3 OR kfc", "NOT top:3", "(kfc top:3) OR coles", "top:2 top:3", "top:0", "top:2.5", "top:x"]) {
    expect(parseFilterStrict(bad).error).toBeDefined()
    expect(parseFilter(bad).error).toBeDefined()
  }
  expect(notForRules(parseFilterStrict("coles top:3").node)).not.toBeNull()
  expect(notForRules(parseFilterStrict('ask:"coffee"').node)).not.toBeNull()
  expect(notForRules(parseFilterStrict("coles").node)).toBeNull()
})
