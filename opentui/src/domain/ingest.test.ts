import { describe, expect, test } from "bun:test"
import { openDb } from "../db/client"
import { ingestAnzCsv } from "./ingest"
import { loadTransactions } from "../db/client"

describe("ANZ ingest", () => {
  test("inserts into ANZ CREDIT and skips dupes", () => {
    const db = openDb(":memory:")
    const csv = [
      '03/02/2026,"-20.00",COFFEE',
      '04/02/2026,"100.00",PAYMENT',
      '03/02/2026,"-20.00",COFFEE', // intra dupe
    ].join("\n")

    const r1 = ingestAnzCsv(db, csv, "ANZ.csv")
    expect(r1.inserted).toBe(2)
    expect(r1.skippedDupes).toBe(1)
    expect(r1.accountName).toBe("ANZ CREDIT")

    const r2 = ingestAnzCsv(db, csv, "ANZ.csv")
    expect(r2.inserted).toBe(0)
    expect(r2.skippedDupes).toBe(3)

    const txns = loadTransactions(db)
    expect(txns).toHaveLength(2)
    expect(txns.every((t) => t.accountName === "ANZ CREDIT")).toBe(true)
    expect(txns.every((t) => t.categoryName === "Uncategorised")).toBe(true)
  })
})
