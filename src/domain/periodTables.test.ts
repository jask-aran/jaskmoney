import { expect, test } from "bun:test"
import { category, transaction } from "../testing/fixtures"
import { merchantRows, trendRows } from "./periodTables"

const home = category({ id: 1, name: "Home", color: "#89b4fa" })
const rent = category({ id: 2, name: "Rent", parentId: 1, color: "#89b4fa" })
const fun = category({ id: 3, name: "Fun", color: "#f38ba8" })
const categories = [home, rent, fun]
let id = 0
const spend = (dateISO: string, amount: number, c = rent, description = "x") => transaction({ id: ++id, dateISO, amount: -amount, categoryId: c.id, categoryName: c.name, description })

test("Trends: a month a row, each group's spending in the range's order, partial months marked", () => {
  const rows = [spend("2026-08-10", 1000), spend("2026-09-03", 1000), spend("2026-09-20", 50, fun), spend("2026-10-02", 40, fun)]
  const out = trendRows(rows, categories, "2026-08-15", "2026-10-31", "2026-10-20", "monday")
  // Home (its subcategory Rent rolled up) first: the range's bigger group.
  expect(out.groups.map((g) => g.name)).toEqual(["Home", "Fun"])
  expect(out.rows.map((r) => [r.label, r.amounts, r.partial])).toEqual([
    // Before the range's start: August's rent isn't in it.
    ["Aug 2026", [0, 0], true],
    ["Sep 2026", [1000, 50], false],
    ["Oct 2026", [0, 40], true],
  ])
})

test("Trends: two months or less go a week a row, labelled from the range's first day", () => {
  const out = trendRows([spend("2026-10-07", 30)], categories, "2026-10-01", "2026-10-31", "2026-11-03", "monday")
  // 1 Oct is a Thursday: its week runs to Sunday 4 Oct.
  expect(out.rows.map((r) => r.label)).toEqual(["1 Oct", "5 Oct", "12 Oct", "19 Oct", "26 Oct"])
  expect(out.rows[0]!.partial).toBe(true)
  expect(out.rows[1]!.total).toBe(30)
})

test("Trends: past the five biggest groups, the rest are Other", () => {
  const many = Array.from({ length: 7 }, (_, i) => category({ id: 10 + i, name: `G${i}` }))
  const rows = many.map((c, i) => spend("2026-09-05", 100 - i, c))
  const out = trendRows(rows, many, "2026-09-01", "2026-09-30", "2026-10-20", "monday")
  expect(out.groups.map((g) => g.name)).toEqual(["G0", "G1", "G2", "G3", "G4", "Other"])
  expect(out.rows.reduce((n, r) => n + r.amounts.at(-1)!, 0)).toBe(95 + 94)
})

test("Merchants: the range's spending by merchant, most first, against the period before", () => {
  const now = [spend("2026-10-02", 20, fun, "CAFE"), spend("2026-10-09", 25, fun, "CAFE"), spend("2026-10-05", 90, rent, "GROCER"), spend("2026-10-06", 15, fun, "NEWBIE")]
  const before = [spend("2026-09-02", 30, fun, "CAFE"), spend("2026-09-05", 100, rent, "GROCER")]
  expect(merchantRows(now, before)).toEqual([
    { merchant: "GROCER", count: 1, spent: 90, before: 100, categoryId: 2 },
    { merchant: "CAFE", count: 2, spent: 45, before: 30, categoryId: 3 },
    { merchant: "NEWBIE", count: 1, spent: 15, before: 0, categoryId: 3 },
  ])
  // No history for the period before: no comparison at all.
  expect(merchantRows(now, null)[0]!.before).toBeNull()
  // Income isn't spending.
  expect(merchantRows([transaction({ id: 99, amount: 500, description: "EMPLOYER" })], null)).toEqual([])
})
