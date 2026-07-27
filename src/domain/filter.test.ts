import { describe, expect, test } from "bun:test"
import {
  evalFilter,
  parseFilter,
  parseFilterStrict,
  reparseFilterInput,
} from "./filter"
import type { FilterTxn } from "./filter"

const base: FilterTxn = {
  description: "UBER *TRIP Sydney",
  categoryName: "Transport",
  accountName: "UP DEBIT",
  notes: "",
  amount: -24.23,
  dateISO: "2026-02-17",
  tagNames: ["CAR", "FUEL"],
}

describe("filter parser", () => {
  test("bare word meta search", () => {
    const { expr } = reparseFilterInput("uber")
    expect(evalFilter(expr, base)).toBe(true)
    expect(evalFilter(expr, { ...base, description: "COFFEE" })).toBe(false)
  })

  test("field predicates + implicit AND", () => {
    const { node, error } = parseFilter("cat:Transport amt:<-20")
    expect(error).toBeUndefined()
    expect(evalFilter(node, base)).toBe(true)
    expect(evalFilter(node, { ...base, amount: -5 })).toBe(false)
  })

  test("tag and type", () => {
    const { node } = parseFilter("tag:FUEL type:debit")
    expect(evalFilter(node, base)).toBe(true)
    expect(evalFilter(node, { ...base, amount: 10 })).toBe(false)
  })

  test("OR and NOT", () => {
    const { node } = parseFilter("cat:Groceries OR cat:Transport")
    expect(evalFilter(node, base)).toBe(true)
    const n2 = parseFilter("NOT tag:CAR").node
    expect(evalFilter(n2, base)).toBe(false)
  })

  test("date range", () => {
    const { node } = parseFilter("date:2026-02-01..2026-02-28")
    expect(evalFilter(node, base)).toBe(true)
    expect(evalFilter(node, { ...base, dateISO: "2026-01-01" })).toBe(false)
  })

  test("strict rejects mixed AND/OR without parens", () => {
    const { error } = parseFilterStrict("cat:A OR cat:B AND amt:>0")
    expect(error).toBeTruthy()
  })

  test("fallback on garbage", () => {
    const { expr } = reparseFilterInput("amt:notanumber")
    // permissive fallback still produces something
    expect(expr).toBeTruthy()
  })
})
