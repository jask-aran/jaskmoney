import { describe, expect, test } from "bun:test"
import { loadTransactions, openDb } from "../db/client"
import { buildImportPreview, commitImportPreview, matchingProfiles } from "./profileImport"
import type { ImportProfile } from "./types"

const profile: ImportProfile = {
  id: "bank", name: "Bank", account: "Everyday", accountType: "debit", importPrefix: "bank", hasHeader: true,
  delimiter: ";", dateColumn: 1, amountColumn: 2, descriptionColumns: [0, 3], amountStrip: "$", dateFormat: "DMY",
}

describe("profile import", () => {
  test("maps a manually configured CSV without writing during preview", () => {
    const db = openDb(":memory:")
    const preview = buildImportPreview(db, 'memo;date;amount;detail\n"Coffee, corner";3/02/2026;"$-12.50";morning\n', "/tmp/bank.csv", profile)
    expect(preview.errors).toEqual([])
    expect(preview.rows[0]).toMatchObject({ dateISO: "2026-02-03", amount: -12.5, description: "Coffee, corner,morning" })
    expect(db.query("SELECT COUNT(*) AS count FROM accounts").get()).toEqual({ count: 0 })
    const result = commitImportPreview(db, preview, true)
    expect(result.accountName).toBe("Everyday")
    expect(loadTransactions(db)).toHaveLength(1)
  })

  test("parse errors block writes and duplicates can be skipped or forced", () => {
    const db = openDb(":memory:")
    const clean = buildImportPreview(db, "memo;date;amount;detail\nA;3/02/2026;$-5;one\n", "/tmp/bank.csv", profile)
    commitImportPreview(db, clean, true)
    const repeat = buildImportPreview(db, "memo;date;amount;detail\nA;3/02/2026;$-5;one\n", "/tmp/bank.csv", profile)
    expect(repeat.duplicateCount).toBe(1)
    expect(commitImportPreview(db, repeat, true).inserted).toBe(0)
    expect(commitImportPreview(db, repeat, false).inserted).toBe(1)
    const invalid = buildImportPreview(db, "memo;date;amount;detail\nA;not-a-date;$-5;one\n", "/tmp/bank.csv", profile)
    expect(invalid.errors).toHaveLength(1)
    expect(() => commitImportPreview(db, invalid, true)).toThrow("parse errors")
  })

  test("uses only longest matching filename prefixes", () => {
    const short = { ...profile, id: "a", importPrefix: "bank" }
    const long = { ...profile, id: "b", importPrefix: "bank-export" }
    expect(matchingProfiles([short, long], "BANK-EXPORT-2026.csv").map((item) => item.id)).toEqual(["b"])
  })

  test("ANZ-style profiles join every trailing description column", () => {
    const db = openDb(":memory:")
    const preview = buildImportPreview(db, '3/02/2026,"-5.00",PAYMENT,REFERENCE\n', "/tmp/anz.csv", { ...profile, hasHeader: false, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: true })
    expect(preview.rows[0]?.description).toBe("PAYMENT,REFERENCE")
  })
})
