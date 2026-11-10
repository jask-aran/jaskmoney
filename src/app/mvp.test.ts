import { settlePending } from "../testing/keys"
import { describe, expect, test, beforeEach, onTestFinished } from "bun:test"
import { handleKey } from "./keys"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { loadTransactions } from "../db/client"
import { buildImportPreview, commitImportPreview } from "../db/profileImport"
import { DEFAULT_IMPORT_PROFILES } from "../state/settingsConfig"
import { account, category, transaction } from "../testing/fixtures"
import { key } from "../testing/keys"
import { testDb } from "../testing/scoped"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

function temporaryCsv(csv: string): string {
  const path = join(mkdtempSync(join(tmpdir(), "jaskmoney-mvp-import-")), "anz.csv")
  writeFileSync(path, csv)
  return path
}

describe("MVP slice: filter + categorize", () => {
  beforeEach(() => {
    data.init(":memory:")
    const anzRow = { categoryId: 10, accountName: "ANZ CREDIT", source: "csv", status: null } as const
    data.setState({
      transactions: [
        transaction({ ...anzRow, id: 1, dateISO: "2026-02-01", amount: -10, description: "COFFEE SHOP" }),
        transaction({ ...anzRow, id: 2, dateISO: "2026-02-02", amount: -20, description: "UBER TRIP" }),
      ],
      accounts: [account({ name: "ANZ CREDIT", type: "credit", source: "csv", externalKind: null, balance: null })],
      categories: [
        category({ id: 4, name: "Transport", color: "#89b4fa" }),
        category({ id: 3, name: "Dining & Drinks", color: "#fab387" }),
        category({ id: 10, name: "Uncategorised", color: "#7f849c", isDefault: true }),
      ],
      filterQuery: "",
      ready: true,
    })
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, filterBar: null, catPicker: null })
  })

  test("categorize apply via picker + real db", async () => {
    data.init(":memory:")
    await data.commitPreview(buildImportPreview(data.getDb()!, '01/02/2026,"-5.00",TEST COFFEE\n', temporaryCsv('01/02/2026,"-5.00",TEST COFFEE\n'), DEFAULT_IMPORT_PROFILES[0]!), true)
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, catPicker: null })
    const targetId = data.scopedTransactions()[0]!.id
    handleKey(ui, key("c"), data)
    for (const ch of "dining") {
      handleKey(ui, key(ch), data)
    }
    handleKey(ui, key("return"), data)
    expect((ui.state.catPicker != null)).toBe(false)
    const row = data.state.transactions.find((t) => t.id === targetId)
    expect(row?.categoryName).toBe("Dining & Drinks")
  })

  test("tag picker stages and applies the focused tag and sort keys change ordering", async () => {
    data.init(":memory:")
    await data.commitPreview(buildImportPreview(data.getDb()!, '01/02/2026,"-5.00",TEST COFFEE\n', temporaryCsv('01/02/2026,"-5.00",TEST COFFEE\n'), DEFAULT_IMPORT_PROFILES[0]!), true)
    ui.switchTab("manager")
    ui.setState({
      focusedSection: "mgr.transactions",
      managerCursor: 0,
      tagPicker: null,
      selectedIds: {},
    })
    const targetId = data.scopedTransactions()[0]!.id
    const initialSort = data.state.sortColumn
    const initialAscending = data.state.sortAscending
    onTestFinished(() => data.setState({ sortColumn: initialSort, sortAscending: initialAscending }))

    handleKey(ui, key("t"), data)
    expect(ui.state.tagPicker !== null).toBe(true)
    const originalTags = [...data.state.transactions.find((row) => row.id === targetId)!.tagIds]
    handleKey(ui, key("space"), data)
    expect(data.state.transactions.find((row) => row.id === targetId)?.tagIds).toEqual(originalTags)
    handleKey(ui, key("return"), data); await settlePending()
    await Promise.resolve()
    expect(data.state.transactions.find((row) => row.id === targetId)?.tagNames).toContain("IGNORE")
    expect(ui.state.tagPicker !== null).toBe(false)

    handleKey(ui, key("s"), data)
    expect(data.state.sortColumn).not.toBe(initialSort)
    const beforeDirection = data.state.sortAscending
    handleKey(ui, key("s", { sequence: "S", shift: true }), data)
    expect(data.state.sortAscending).toBe(!beforeDirection)
  })
})

describe("default ANZ profile import", () => {
  test("preserves ANZ dates, amounts, and joined descriptions without a header", () => {
    const db = testDb()
    const csv = [
      '03/02/2026,"203.92",PAYMENT THANKYOU 100001',
      "03/02/2026,\"-20.00\",DAN MURPHY'S/580 MELBOURN RIVERSIDE",
      '02/02/2026,"10.00",FOO,BAR EXTRA',
      '3/2/2026,"$1,234.56",THOUSANDS',
    ].join("\n")
    const preview = buildImportPreview(db, csv, "anz.csv", DEFAULT_IMPORT_PROFILES[0]!)
    expect(preview.errors).toEqual([])
    expect(preview.rows).toHaveLength(4)
    expect(preview.rows[0]!.dateISO).toBe("2026-02-03")
    expect(preview.rows[0]!.amount).toBe(203.92)
    expect(preview.rows[1]!.amount).toBe(-20)
    expect(preview.rows[2]!.description).toBe("FOO,BAR EXTRA")
    expect(preview.rows[3]!.dateISO).toBe("2026-02-03")
    expect(preview.rows[3]!.amount).toBe(1234.56)
    const bareAmount = buildImportPreview(db, '03/02/2026,"1,234.56",THOUSANDS', "anz.csv", DEFAULT_IMPORT_PROFILES[0]!)
    expect(bareAmount.errors).toEqual([])
    expect(bareAmount.rows[0]!.amount).toBe(1234.56)
    commitImportPreview(db, preview, true)
    expect(loadTransactions(db)).toHaveLength(4)
    const invalid = buildImportPreview(db, '32/01/2026,1,INVALID', "anz.csv", DEFAULT_IMPORT_PROFILES[0]!)
    expect(invalid.rows).toHaveLength(0)
    expect(invalid.errors[0]?.field).toBe("date")
  })

  test("imports as uncategorised credit and skips every row on re-import", () => {
    const db = testDb()
    const csv = '03/02/2026,"-20.00",COFFEE\n04/02/2026,"100.00",PAYMENT'
    const first = commitImportPreview(db, buildImportPreview(db, csv, "anz.csv", DEFAULT_IMPORT_PROFILES[0]!), true)
    expect(first.inserted).toBe(2)
    expect(first.skippedDupes).toBe(0)
    expect(first.accountName).toBe("ANZ CREDIT")
    expect(db.query("SELECT type FROM accounts WHERE id = ?").get(first.accountId)).toEqual({ type: "credit" })
    const repeat = commitImportPreview(db, buildImportPreview(db, csv, "anz.csv", DEFAULT_IMPORT_PROFILES[0]!), true)
    expect(repeat.inserted).toBe(0)
    expect(repeat.skippedDupes).toBe(2)
    const txns = loadTransactions(db)
    expect(txns).toHaveLength(2)
    expect(txns.every((t) => t.accountName === "ANZ CREDIT")).toBe(true)
    expect(txns.every((t) => t.categoryName === "Uncategorised")).toBe(true)
    const repeated = buildImportPreview(db, csv + '\n03/02/2026,"-20.00",COFFEE', "anz.csv", DEFAULT_IMPORT_PROFILES[0]!)
    const repeatedResult = commitImportPreview(db, repeated, true)
    expect(repeatedResult.inserted).toBe(0)
    expect(repeatedResult.skippedDupes).toBe(3)
  })

  test("applies enabled rules only to newly imported rows when rulesEnabled is true", async () => {
    data.init(":memory:")
    const db = data.getDb()!
    const profile = DEFAULT_IMPORT_PROFILES[0]!
    const csv = '01/02/2026,-5,COFFEE'
    const first = buildImportPreview(db, csv, temporaryCsv(csv), profile)
    first.rulesEnabled = false
    await data.commitPreview(first, true)
    const oldId = data.state.transactions[0]!.id
    const category = data.state.categories.find((c) => c.name === "Dining & Drinks")!
    data.setState({ savedFilters: [{ id: "coffee", name: "Coffee", expr: "desc:COFFEE" }] })
    await data.createSettingsRule({ name: "Coffee", savedFilterId: "coffee", setCategoryId: category.id, addTagIds: [], enabled: true })
    const disabledCsv = '02/02/2026,-6,COFFEE'
    const disabled = buildImportPreview(db, disabledCsv, temporaryCsv(disabledCsv), profile)
    disabled.rulesEnabled = false
    await data.commitPreview(disabled, true)
    expect(data.state.transactions.every((t) => t.categoryName === "Uncategorised")).toBe(true)
    const nextCsv = csv + '\n03/02/2026,-7,COFFEE'
    const next = buildImportPreview(db, nextCsv, temporaryCsv(nextCsv), profile)
    expect(next.rulesEnabled).toBe(true)
    await data.commitPreview(next, true)
    expect(data.state.transactions).toHaveLength(3)
    expect(data.state.transactions.find((t) => t.id === oldId)?.categoryName).toBe("Uncategorised")
    expect(data.state.transactions.find((t) => t.dateISO === "2026-02-03")?.categoryName).toBe("Dining & Drinks")
  })
})
