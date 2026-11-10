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
  categoryId: 4,
  categoryName: "Transport",
  accountName: "UP DEBIT",
  notes: "",
  amount: -24.23,
  dateISO: "2026-02-17",
  tagNames: ["CAR", "FUEL"],
}

test("filter parser: bare words, fields with implicit AND, tag and type, OR and NOT, date ranges", () => {
  const { expr } = reparseFilterInput("uber")
  expect(evalFilter(expr, base)).toBe(true)
  expect(evalFilter(expr, { ...base, description: "COFFEE" })).toBe(false)
  const cases: Array<[string, Partial<FilterTxn>, boolean]> = [
    ["cat:Transport amt:<-20", {}, true], ["cat:Transport amt:<-20", { amount: -5 }, false],
    ["tag:FUEL type:debit", {}, true], ["tag:FUEL type:debit", { amount: 10 }, false],
    ["cat:Groceries OR cat:Transport", {}, true], ["NOT tag:CAR", {}, false],
    ["date:2026-02-01..2026-02-28", {}, true], ["date:2026-02-01..2026-02-28", { dateISO: "2026-01-01" }, false],
  ]
  for (const [query, over, want] of cases) {
    const { node, error } = parseFilter(query)
    expect({ query, over, error, got: evalFilter(node, { ...base, ...over }) }).toEqual({ query, over, error: undefined, got: want })
  }
  expect(parseFilterStrict("cat:A OR cat:B AND amt:>0").error).toBeTruthy()
})

test("filter dates reject impossible days in single values and range endpoints", () => {
  for (const query of ["date:2026-02-31", "date:2026-02-31..2026-03-05", "date:2026-02-01..2026-02-31", "date:2025-02-29", "date:2026-13-01"]) {
    for (const parse of [parseFilter, parseFilterStrict]) {
      expect(parse(query).error).toBe("invalid date")
    }
  }
  const { node, error } = parseFilterStrict("date:2024-02-29")
  expect(error).toBeUndefined()
  expect(evalFilter(node, { ...base, dateISO: "2024-02-29" })).toBe(true)
})

test("type:spending and type:income follow the money rules while debit and credit keep their meanings", () => {
  const spending = parseFilterStrict("type:spending")
  expect(spending.error).toBeUndefined()
  expect(evalFilter(spending.node, base)).toBe(true)
  expect(evalFilter(spending.node, { ...base, amount: 10 })).toBe(true)
  const uncategorisedIn = { ...base, amount: 10, categoryId: null, categoryName: "Uncategorised" }
  for (const row of [{ ...base, excluded: true }, { ...base, tagNames: ["iGnOrE"] }, { ...base, amount: 0 }, uncategorisedIn, { ...base, income: true }]) {
    expect(evalFilter(spending.node, row)).toBe(false)
  }
  const income = parseFilterStrict("type:income")
  expect(income.error).toBeUndefined()
  expect(evalFilter(income.node, { ...base, amount: 100, income: true })).toBe(true)
  for (const row of [{ ...base, amount: 100 }, uncategorisedIn, { ...base, amount: 100, income: true, excluded: true }]) {
    expect(evalFilter(income.node, row)).toBe(false)
  }
  expect(evalFilter(parseFilterStrict("type:debit").node, { ...base, excluded: true, tagNames: ["IGNORE"] })).toBe(true)
  expect(evalFilter(parseFilterStrict("type:credit").node, { ...base, amount: 10, excluded: true, tagNames: ["IGNORE"] })).toBe(true)
})

describe("text matching ignores case, spacing and punctuation (approved deviation from legacy's plain substring)", () => {
  const row = (description: string, notes = ""): FilterTxn => ({ ...base, description, notes })
  const matches = (expr: string, description: string, notes = "") => evalFilter(parseFilterStrict(expr).node, row(description, notes))

  test("desc:, note: and bare words find the bank's spelling", () => {
    for (const q of ["desc:mcdonalds", 'desc:"Mc Donalds"', "desc:mcdonald's", "mcdonalds"]) expect(matches(q, "McDonald's")).toBe(true)
    expect(matches("desc:ubertrip", "UBER *TRIP Sydney")).toBe(true)
    expect(matches("note:kestrelram", "Corner Bar", "Kestrel RAM!")).toBe(true)
    expect(matches('desc:"coffee shop"', "The Coffee Shop")).toBe(true)
  })
})
