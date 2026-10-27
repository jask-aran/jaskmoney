import { expect, test } from "bun:test"
import { monthlyTotal, subscriptions } from "./subscriptions"
import { transaction } from "../testing/fixtures"

let id = 0
const charge = (description: string, dateISO: string, amount: number, overrides = {}) => transaction({ id: ++id, description, dateISO, amount: -amount, ...overrides })
const monthly = (description: string, amounts: number[], from = "2026-05-03") =>
  amounts.map((amount, i) => charge(description, `2026-${String(Number(from.slice(5, 7)) + i).padStart(2, "0")}${from.slice(7)}`, amount))

test("monthly cost, next charge, a recent price change, and active before stopped", () => {
  const rows = [
    ...monthly("NETFLIX", [18.99, 18.99, 22.99, 22.99, 22.99]),            // May–Sep, rose in Jul
    ...monthly("GYM", [60, 60, 60]),                                         // May–Jul: stopped (Aug, Sep missed)
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((w) => charge("COFFEE CLUB", `2026-${w < 4 ? "08" : "09"}-${String(1 + (w % 4) * 7).padStart(2, "0")}`, 5)), // weekly
    ...monthly("OLD THING", [9, 9, 9], "2025-01-10"),                         // stopped long ago: gone
  ]
  const list = subscriptions(rows, "2026-09-20")
  expect(list.map((s) => s.name)).toEqual(["NETFLIX", "COFFEE CLUB", "GYM"])
  const netflix = list.find((s) => s.name === "NETFLIX")!
  expect(netflix).toMatchObject({ cadence: "monthly", amount: 22.99, last: "2026-09-03", stopped: false, change: { from: 18.99, to: 22.99, since: "2026-07-03" } })
  expect(netflix.next >= "2026-10-02" && netflix.next <= "2026-10-04").toBe(true)
  const coffee = list.find((s) => s.name === "COFFEE CLUB")!
  expect(coffee.monthly).toBeCloseTo(5 * 52 / 12)
  expect(coffee.change).toBeNull()
  expect(list.find((s) => s.name === "GYM")!.stopped).toBe(true)
  expect(monthlyTotal(list)).toBeCloseTo(22.99 + 5 * 52 / 12)
})

test("a change long ago isn't news; transfers aren't subscriptions", () => {
  const rows = [
    ...monthly("SPOTIFY", [11.99, 13.99, 13.99, 13.99, 13.99, 13.99, 13.99, 13.99], "2026-01-05"),
    ...monthly("TO HOLIDAY SAVER", [100, 100, 100, 100]).map((t) => ({ ...t, internal: true, excluded: true })),
  ]
  const list = subscriptions(rows, "2026-09-10")
  expect(list.map((s) => s.name)).toEqual(["SPOTIFY"])
  expect(list[0]!.change).toBeNull()
})
