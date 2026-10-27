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

// Approved change: impossible days must fail rather than overflow into March.
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
  // A refund into a spending category counts against it.
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
    // Everything legacy matched still matches.
    expect(matches('desc:"coffee shop"', "The Coffee Shop")).toBe(true)
  })

  test("letters stay in order: no scattered (picker-style) matches", () => {
    expect(matches("desc:bp", "Bunnings Warehouse")).toBe(false)
    expect(matches("desc:mcd", "McDonald's")).toBe(true)
    expect(matches("desc:donaldmc", "McDonald's")).toBe(false)
  })

  test("other scripts and accents are letters; a needle of only punctuation matches as written", () => {
    expect(matches("desc:茶馆", "Tea House 茶馆")).toBe(true)
    expect(matches("desc:cafe", "Café Rio")).toBe(false)
    expect(matches("desc:café", "CAFÉ Rio")).toBe(true)
    expect(matches('desc:"*"', "UBER *TRIP")).toBe(true)
    expect(matches('desc:"*"', "Coles")).toBe(false)
  })

  test("exact fields stay exact", () => {
    expect(evalFilter(parseFilterStrict('cat:"Trans port"').node, base)).toBe(false)
  })
})
