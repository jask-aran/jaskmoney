import { describe, expect, test, beforeEach } from "bun:test"
import type { KeyEvent } from "@opentui/core"
import { handleKey } from "./keys"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { openDb, loadTransactions } from "../db/client"
import { buildImportPreview, commitImportPreview } from "../domain/profileImport"
import { DEFAULT_IMPORT_PROFILES } from "../state/settingsConfig"
import { setTransactionCategory } from "../db/client"

function key(partial: Partial<KeyEvent> & { name: string }): KeyEvent {
  return {
    name: partial.name,
    ctrl: partial.ctrl ?? false,
    meta: partial.meta ?? false,
    shift: partial.shift ?? false,
    option: partial.option ?? false,
    sequence: partial.sequence ?? partial.name,
    number: false,
    raw: partial.name,
    eventType: "press",
    source: "raw",
    preventDefault() {},
    stopPropagation() {},
    get defaultPrevented() {
      return false
    },
    get propagationStopped() {
      return false
    },
  } as KeyEvent
}

describe("MVP slice: filter + categorize", () => {
  beforeEach(() => {
    data.init(":memory:")
    data.setState({
      transactions: [
        {
          id: 1,
          dateRaw: "1",
          dateISO: "2026-02-01",
          amount: -10,
          description: "COFFEE SHOP",
          categoryId: 10,
          categoryName: "Uncategorised",
          categoryColor: "#7f849c",
          notes: "",
          importId: null,
          accountId: 1,
          accountName: "ANZ CREDIT",
          tagNames: [],
          tagColors: [],
          tagIds: [], source: "csv" as const, status: null, transferAccountId: null, internal: false,
        },
        {
          id: 2,
          dateRaw: "2",
          dateISO: "2026-02-02",
          amount: -20,
          description: "UBER TRIP",
          categoryId: 10,
          categoryName: "Uncategorised",
          categoryColor: "#7f849c",
          notes: "",
          importId: null,
          accountId: 1,
          accountName: "ANZ CREDIT",
          tagNames: [],
          tagColors: [],
          tagIds: [], source: "csv" as const, status: null, transferAccountId: null, internal: false,
        },
      ],
      accounts: [
        { id: 1, name: "ANZ CREDIT", type: "credit", sortOrder: 1, isActive: true, source: "csv" as const, externalKind: null, balance: null, syncEnabled: true },
      ],
      categories: [
        { id: 4, name: "Transport", color: "#89b4fa", sortOrder: 4, isDefault: false },
        { id: 3, name: "Dining & Drinks", color: "#fab387", sortOrder: 3, isDefault: false },
        { id: 10, name: "Uncategorised", color: "#7f849c", sortOrder: 10, isDefault: true },
      ],
      filterQuery: "",
      ready: true,
    })
    ui.switchTab("manager")
    ui.setState({
      focusedSection: "mgr.transactions",
      managerCursor: 0,
      filterMode: false,
      catPickerOpen: false,
    })
  })

  test("filter narrows scoped rows", () => {
    data.clearFilter()
    handleKey(ui, key({ name: "/", sequence: "/" }), data)
    expect(ui.state.filterMode).toBe(true)
    for (const ch of "uber") {
      handleKey(ui, key({ name: ch, sequence: ch }), data)
    }
    handleKey(ui, key({ name: "return" }), data)
    expect(data.state.filterQuery).toBe("uber")
    expect(data.scopedTransactions()).toHaveLength(1)
    expect(data.scopedTransactions()[0]!.description).toContain("UBER")
    data.clearFilter()
  })

  test("categorize updates via db helper", () => {
    const db = openDb(":memory:")
    commitImportPreview(db, buildImportPreview(db, '01/02/2026,"-5.00",TEST COFFEE\n', "t.csv", DEFAULT_IMPORT_PROFILES[0]!), true)
    const before = loadTransactions(db)
    expect(before[0]!.categoryName).toBe("Uncategorised")
    const transport = db
      .query(`SELECT id FROM categories WHERE name = 'Transport'`)
      .get() as { id: number }
    setTransactionCategory(db, before[0]!.id, transport.id)
    const after = loadTransactions(db)
    expect(after[0]!.categoryName).toBe("Transport")
  })

  test("open cat picker with c", () => {
    handleKey(ui, key({ name: "c", sequence: "c" }), data)
    expect(ui.state.catPickerOpen).toBe(true)
    handleKey(ui, key({ name: "escape" }), data)
    expect(ui.state.catPickerOpen).toBe(false)
  })

  test("categorize apply via picker + real db", () => {
    data.init(":memory:")
    data.commitPreview(buildImportPreview(data.getDb()!, '01/02/2026,"-5.00",TEST COFFEE\n', "anz.csv", DEFAULT_IMPORT_PROFILES[0]!), true)
    ui.switchTab("manager")
    ui.setState({
      focusedSection: "mgr.transactions",
      managerCursor: 0,
      catPickerOpen: false,
    })
    const targetId = data.scopedTransactions()[0]!.id
    handleKey(ui, key({ name: "c", sequence: "c" }), data)
    for (const ch of "dining") {
      handleKey(ui, key({ name: ch, sequence: ch }), data)
    }
    handleKey(ui, key({ name: "return" }), data)
    expect(ui.state.catPickerOpen).toBe(false)
    const row = data.state.transactions.find((t) => t.id === targetId)
    expect(row?.categoryName).toBe("Dining & Drinks")
  })

  test("escape clears transaction selection before an applied filter", () => {
    ui.setState({ selectedIds: { 1: true } })
    data.commitFilter("uber")

    handleKey(ui, key({ name: "escape" }), data)

    expect(ui.state.selectedIds).toEqual({})
    expect(data.state.filterQuery).toBe("uber")

    handleKey(ui, key({ name: "escape" }), data)
    expect(data.state.filterQuery).toBe("")
  })

  test("tag picker toggles the focused tag and sort keys change ordering", () => {
    data.init(":memory:")
    data.commitPreview(buildImportPreview(data.getDb()!, '01/02/2026,"-5.00",TEST COFFEE\n', "anz.csv", DEFAULT_IMPORT_PROFILES[0]!), true)
    ui.switchTab("manager")
    ui.setState({
      focusedSection: "mgr.transactions",
      managerCursor: 0,
      tagPickerOpen: false,
      selectedIds: {},
    })
    const targetId = data.scopedTransactions()[0]!.id
    const initialSort = data.state.sortColumn

    handleKey(ui, key({ name: "t", sequence: "t" }), data)
    expect(ui.state.tagPickerOpen).toBe(true)
    handleKey(ui, key({ name: "space", sequence: " " }), data)
    expect(data.state.transactions.find((row) => row.id === targetId)?.tagNames).toContain("IGNORE")
    handleKey(ui, key({ name: "return" }), data)
    expect(ui.state.tagPickerOpen).toBe(false)

    handleKey(ui, key({ name: "s", sequence: "s" }), data)
    expect(data.state.sortColumn).not.toBe(initialSort)
    const beforeDirection = data.state.sortAscending
    handleKey(ui, key({ name: "s", sequence: "S", shift: true }), data)
    expect(data.state.sortAscending).toBe(!beforeDirection)
  })
})


describe("default ANZ profile import", () => {
  test("preserves ANZ dates, amounts, and joined descriptions without a header", () => {
    const db = openDb(":memory:")
    try {
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
    } finally { db.close() }
  })

  test("imports as uncategorised credit and skips every row on re-import", () => {
    const db = openDb(":memory:")
    try {
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
      // The removed importer skipped intra-file duplicates. Profile preview and
      // legacy/go/ingest.go keep them on first import; preserve that behavior.
      const repeated = buildImportPreview(db, csv + '\n03/02/2026,"-20.00",COFFEE', "anz.csv", DEFAULT_IMPORT_PROFILES[0]!)
      const repeatedResult = commitImportPreview(db, repeated, true)
      expect(repeatedResult.inserted).toBe(0)
      expect(repeatedResult.skippedDupes).toBe(3)
    } finally { db.close() }
  })

  test("applies enabled rules only to newly imported rows when rulesEnabled is true", () => {
    data.init(":memory:")
    const db = data.getDb()!
    const profile = DEFAULT_IMPORT_PROFILES[0]!
    const csv = '01/02/2026,-5,COFFEE'
    const first = buildImportPreview(db, csv, "anz.csv", profile)
    first.rulesEnabled = false
    data.commitPreview(first, true)
    const oldId = data.state.transactions[0]!.id
    const category = data.state.categories.find((c) => c.name === "Dining & Drinks")!
    data.setState({ savedFilters: [{ id: "coffee", name: "Coffee", expr: "desc:COFFEE" }] })
    data.createSettingsRule({ name: "Coffee", savedFilterId: "coffee", setCategoryId: category.id, addTagIds: [], enabled: true })
    const disabled = buildImportPreview(db, '02/02/2026,-6,COFFEE', "anz.csv", profile)
    disabled.rulesEnabled = false
    data.commitPreview(disabled, true)
    expect(data.state.transactions.every((t) => t.categoryName === "Uncategorised")).toBe(true)
    const next = buildImportPreview(db, csv + '\n03/02/2026,-7,COFFEE', "anz.csv", profile)
    expect(next.rulesEnabled).toBe(true)
    data.commitPreview(next, true)
    expect(data.state.transactions).toHaveLength(3)
    expect(data.state.transactions.find((t) => t.id === oldId)?.categoryName).toBe("Uncategorised")
    expect(data.state.transactions.find((t) => t.dateISO === "2026-02-03")?.categoryName).toBe("Dining & Drinks")
  })
})
