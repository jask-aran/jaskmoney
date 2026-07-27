import { describe, expect, test, beforeEach } from "bun:test"
import type { KeyEvent } from "@opentui/core"
import { handleKey } from "./keys"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { openDb, loadTransactions } from "../db/client"
import { ingestAnzCsv } from "../domain/ingest"
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
          tagIds: [],
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
          tagIds: [],
        },
      ],
      accounts: [
        { id: 1, name: "ANZ CREDIT", type: "credit", sortOrder: 1, isActive: true },
      ],
      accountScope: { 1: true },
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
    ingestAnzCsv(db, '01/02/2026,"-5.00",TEST COFFEE\n', "t.csv")
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
    const path = data.findDefaultAnzPath()
    expect(path).toBeTruthy()
    data.ingestFile(path!)
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

  test("escape leaves transaction selection and applied filter intact", () => {
    ui.setState({ selectedIds: { 1: true } })
    data.commitFilter("uber")

    handleKey(ui, key({ name: "escape" }), data)

    expect(ui.state.selectedIds).toEqual({ 1: true })
    expect(data.state.filterQuery).toBe("uber")
  })

  test("tag picker toggles the focused tag and sort keys change ordering", () => {
    data.init(":memory:")
    const path = data.findDefaultAnzPath()
    expect(path).toBeTruthy()
    data.ingestFile(path!)
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
