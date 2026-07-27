import { describe, expect, test } from "bun:test"
import {
  applyChip,
  defaultTimeframe,
  filterByTimeframe,
  timeframeBounds,
} from "./timeframe"
import type { Transaction } from "./types"

function txn(dateISO: string, amount = -10): Transaction {
  return {
    id: 1,
    dateRaw: dateISO,
    dateISO,
    amount,
    description: "x",
    categoryId: 1,
    categoryName: "A",
    categoryColor: "#94e2d5",
    notes: "",
    importId: null,
    accountId: 1,
    accountName: "A",
    tagNames: [],
          tagColors: [],
          tagIds: [],
  }
}

describe("timeframe", () => {
  const now = new Date(2026, 1, 18) // 18 Feb 2026

  test("month period bounds", () => {
    const tf = defaultTimeframe(now)
    const b = timeframeBounds(tf, now)
    expect(b.start).toBe("2026-02-01")
    expect(b.end).toBe("2026-02-28")
  })

  test("lookback 1M", () => {
    let tf = defaultTimeframe(now)
    tf = applyChip(tf, 0, now) // 1M
    const b = timeframeBounds(tf, now)
    expect(b.start).toBe("2026-01-18")
    expect(b.end).toBe("2026-02-18")
  })

  test("filter rows", () => {
    const tf = defaultTimeframe(now)
    const rows = [
      txn("2026-01-15"),
      txn("2026-02-03"),
      txn("2026-03-01"),
    ]
    const filtered = filterByTimeframe(rows, tf, now)
    expect(filtered.map((r) => r.dateISO)).toEqual(["2026-02-03"])
  })
})
