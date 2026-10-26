import { describe, expect, test, beforeEach } from "bun:test"
import type { KeyEvent } from "@opentui/core"
import { spendingScope } from "../domain/accountTree"
import { CUSTOM_CHIP, LOOKBACKS, PERIODS, applyChip } from "../domain/timeframe"
import { handleKey, footerHints } from "./keys"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { openDb, loadTransactions, loadTransactionDetail, setTransactionNotes } from "../db/client"

function key(partial: Partial<KeyEvent> & { name: string }): KeyEvent {
  return {
    name: partial.name,
    ctrl: partial.ctrl ?? false,
    meta: partial.meta ?? false,
    shift: partial.shift ?? false,
    option: partial.option ?? false,
    sequence: partial.sequence ?? partial.name,
    number: partial.number ?? false,
    raw: partial.raw ?? partial.name,
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

describe("key router", () => {
  beforeEach(() => {
    data.clearFilter()
    ui.switchTab("overview")
    ui.setState({
      jumpMode: false,
      focusedSection: "none",
      managerCursor: 0,
      managerTop: 0,
      selectedIds: {},
      rangeSelecting: false,
      status: "reset",
    })
  })

  test("number keys switch tabs", () => {
    handleKey(ui, key({ name: "2" }), data)
    expect(ui.state.activeTab).toBe("manager")
    handleKey(ui, key({ name: "3" }), data)
    expect(ui.state.activeTab).toBe("settings")
    handleKey(ui, key({ name: "1" }), data)
    expect(ui.state.activeTab).toBe("overview")
  })

  test("tab cycles", () => {
    handleKey(ui, key({ name: "tab" }), data)
    expect(ui.state.activeTab).toBe("manager")
    handleKey(ui, key({ name: "tab", shift: true }), data)
    expect(ui.state.activeTab).toBe("overview")
  })

  test("jump mode open, target, cancel", () => {
    handleKey(ui, key({ name: "v" }), data)
    expect(ui.state.jumpMode).toBe(true)
    handleKey(ui, key({ name: "d" }), data)
    expect(ui.state.jumpMode).toBe(false)
    expect(ui.state.focusedSection).toBe("ov.range")

    handleKey(ui, key({ name: "v" }), data)
    handleKey(ui, key({ name: "escape" }), data)
    expect(ui.state.jumpMode).toBe(false)
  })

  test("account sidebar selection drives the manager table, not the dashboard", () => {
    const account = (id: number, name: string, externalKind: string) => ({
      id, name, type: "debit" as const, sortOrder: id, isActive: true, source: "up" as const, externalKind, balance: id * 100, syncEnabled: true,
    })
    const txn = (id: number, accountId: number) => ({
      id, dateRaw: "x", dateISO: `2026-02-0${id}`, amount: -id, description: `T${id}`, categoryId: 1, categoryName: "U",
      categoryColor: "#7f849c", notes: "", importId: null, accountId, accountName: "", tagNames: [], tagColors: [], tagIds: [],
      source: "up" as const, status: null, transferAccountId: null, internal: false, excluded: false,
    })
    data.setState({
      accounts: [account(1, "Spending", "TRANSACTIONAL"), account(2, "Holiday", "SAVER"), account(3, "General", "SAVER")],
      transactions: [txn(1, 1), txn(2, 2), txn(3, 3)],
      accountSelection: "all",
      ready: true,
    })
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.accounts", accountCursor: 0 })
    const shown = () => data.scopedTransactions().map((t) => t.id).sort()

    // Entries: All spending, Spending, Savers, Holiday, General.
    expect(shown()).toEqual([1])
    handleKey(ui, key({ name: "j" }), data)
    expect(data.state.accountSelection).toBe(1)
    handleKey(ui, key({ name: "j" }), data)
    expect(data.state.accountSelection).toBe("savers")
    expect(shown()).toEqual([2, 3])
    handleKey(ui, key({ name: "j" }), data)
    expect(data.state.accountSelection).toBe(2)
    expect(shown()).toEqual([2])
    // A saver selected: the Spending tab covers every spending account.
    expect(spendingScope(data.state.accounts, data.state.accountSelection).accounts.map((a) => a.id)).toEqual([1])
    // Data actions only for a single account.
    handleKey(ui, key({ name: "d" }), data)
    expect(ui.state.accountActionId).toBe(2)
    ui.setState({ accountActionId: null })
    handleKey(ui, key({ name: "k" }), data)
    handleKey(ui, key({ name: "d" }), data)
    expect(ui.state.accountActionId).toBeNull()
    handleKey(ui, key({ name: "return" }), data)
    expect(ui.state.focusedSection).toBe("mgr.transactions")
    data.setState({ accountSelection: "all" })
  })

  test("transaction detail opens on enter, owns input, and targets its own row", () => {
    const txn = (id: number) => ({
      id, dateRaw: "x", dateISO: `2026-02-0${id}`, amount: -id, description: `T${id}`, categoryId: 1, categoryName: "U",
      categoryColor: "#7f849c", notes: id === 2 ? "kept" : "", importId: null, accountId: 1, accountName: "A", tagNames: [],
      tagColors: [], tagIds: [], source: "up" as const, status: null, transferAccountId: null, internal: false, excluded: false,
    })
    data.setState({
      accounts: [{ id: 1, name: "A", type: "debit" as const, sortOrder: 1, isActive: true, source: "up" as const, externalKind: "TRANSACTIONAL", balance: 1, syncEnabled: true }],
      transactions: [txn(3), txn(2), txn(1)],
      accountSelection: "all",
      ready: true,
    })
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0, selectedIds: { 1: true } })
    handleKey(ui, key({ name: "return" }), data)
    expect(ui.state.detailId).toBe(3)
    expect(ui.activeScope()).toBe("manager.detail")
    // The detail row wins over the selection for pickers.
    expect(ui.targetIds(data.scopedTransactions())).toEqual([3])
    // j browses to the next row without closing.
    handleKey(ui, key({ name: "j" }), data)
    expect(ui.state.detailId).toBe(2)
    // Tab keys are swallowed while the modal is open.
    handleKey(ui, key({ name: "1" }), data)
    expect(ui.state.activeTab).toBe("manager")
    // n edits notes starting from the current value; printable keys are text.
    handleKey(ui, key({ name: "n" }), data)
    expect(ui.activeScope()).toBe("manager.detail.notes")
    expect(ui.state.detailNotesDraft).toBe("kept")
    handleKey(ui, key({ name: "j", sequence: "j" }), data)
    expect(ui.state.detailNotesDraft).toBe("keptj")
    handleKey(ui, key({ name: "escape" }), data)
    expect(ui.state.detailNotesEditing).toBe(false)
    handleKey(ui, key({ name: "escape" }), data)
    expect(ui.state.detailId).toBeNull()
    expect(ui.targetIds(data.scopedTransactions())).toEqual([1])
    ui.setState({ selectedIds: {} })
  })

  test("transactions: m groups the filtered rows by merchant; enter narrows the filter to one", () => {
    const iso = "2026-10-01"
    const txn = (id: number, description: string, amount: number) => ({
      id, dateRaw: "x", dateISO: iso, amount, description, categoryId: 1, categoryName: "U", categoryColor: "#7f849c",
      notes: "", importId: null, accountId: 1, accountName: "Spending", tagNames: [], tagColors: [], tagIds: [],
      source: "up" as const, status: null, transferAccountId: null, internal: false, excluded: false,
    })
    data.setState({
      accounts: [{ id: 1, name: "Spending", type: "debit" as const, sortOrder: 1, isActive: true, source: "up" as const, externalKind: "TRANSACTIONAL", balance: 1, syncEnabled: true }],
      transactions: [txn(1, "Big Shop", -90), txn(2, 'Cafe "Ripple"', -10), txn(3, 'Cafe "Ripple"', -5)],
      accountSelection: "all",
      ready: true,
    })
    data.clearFilter()
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions", txnView: "rows" })
    handleKey(ui, key({ name: "m" }), data)
    expect(ui.activeScope()).toBe("manager.merchants")
    // Biggest spend first: Big Shop, then the cafe.
    handleKey(ui, key({ name: "j" }), data)
    expect(ui.state.merchantCursor).toBe(1)
    handleKey(ui, key({ name: "c" }), data)
    expect([...ui.state.pickerTargets].sort()).toEqual([2, 3])
    handleKey(ui, key({ name: "escape" }), data)
    handleKey(ui, key({ name: "return" }), data)
    expect(ui.state.txnView).toBe("rows")
    expect(data.state.filterQuery).toBe('desc:"Cafe \\"Ripple\\""')
    expect(data.scopedTransactions().map((t) => t.id).sort()).toEqual([2, 3])
    data.clearFilter()
  })


  test("manager cursor moves with j/k", () => {
    data.setState({
      transactions: [1, 2, 3].map((id) => ({
        id,
        dateRaw: String(id),
        dateISO: `2026-02-0${id}`,
        amount: -id,
        description: "x",
        categoryId: 1,
        categoryName: "U",
        categoryColor: "#7f849c",
        notes: "",
        importId: null,
        accountId: 1,
        accountName: "A",
        tagNames: [],
          tagColors: [],
          tagIds: [], source: "csv" as const, status: null, transferAccountId: null, internal: false, excluded: false,
      })),
      accounts: [{ id: 1, name: "A", type: "credit" as const, sortOrder: 1, isActive: true, source: "csv" as const, externalKind: null, balance: null, syncEnabled: true }],
      ready: true,
    })

    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0 })
    handleKey(ui, key({ name: "j" }), data)
    expect(ui.state.managerCursor).toBe(1)
    handleKey(ui, key({ name: "j" }), data)
    expect(ui.state.managerCursor).toBe(2)
    handleKey(ui, key({ name: "k" }), data)
    expect(ui.state.managerCursor).toBe(1)
    handleKey(ui, key({ name: "g" }), data)
    expect(ui.state.managerCursor).toBe(0)
  })

  test("Escape mirrors u when clearing transaction selection and filters", () => {
    ui.switchTab("manager")
    ui.setState({
      focusedSection: "mgr.transactions",
      selectedIds: { 1: true },
      rangeSelecting: true,
      rangeAnchorId: 1,
      rangeCursorId: 2,
    })

    handleKey(ui, key({ name: "escape" }), data)
    expect(ui.state.selectedIds).toEqual({})
    expect(ui.state.rangeSelecting).toBe(false)
    expect(ui.state.status).toBe("Selection cleared")

    data.setFilterLive("coffee")
    handleKey(ui, key({ name: "escape" }), data)
    expect(data.state.filterQuery).toBe("")
    expect(ui.state.status).toBe("Filter cleared")
  })

  test("overview h/l step the top or focused chart; H/L the bottom one", () => {
    ui.setState({ focusedSection: "none", chartViews: [0, 4] })
    handleKey(ui, key({ name: "l" }), data)
    expect(ui.state.chartViews).toEqual([1, 4])
    handleKey(ui, key({ name: "h" }), data)
    handleKey(ui, key({ name: "h" }), data)
    expect(ui.state.chartViews).toEqual([7, 4])
    handleKey(ui, key({ name: "l", shift: true, sequence: "L" }), data)
    expect(ui.state.chartViews).toEqual([7, 5])
    ui.setState({ focusedSection: "ov.chart2" })
    handleKey(ui, key({ name: "h" }), data)
    expect(ui.state.chartViews).toEqual([7, 4])
  })

  test("drill-down: enter on a category line opens its transactions; esc comes back", () => {
    const category = (id: number, name: string, parentId: number | null = null) => ({ id, name, color: "#fff", sortOrder: id, isDefault: false, parentId, extId: null, notSpending: false })
    const txn = (id: number, categoryId: number, categoryName: string, amount: number) => ({
      id, dateRaw: "x", dateISO: "2026-10-10", amount, description: `T${id}`, categoryId, categoryName,
      categoryColor: "#fff", notes: "", importId: null, accountId: 1, accountName: "Spending", tagNames: [], tagColors: [], tagIds: [],
      source: "up" as const, status: null, transferAccountId: null, internal: false, excluded: false,
    })
    data.setState({
      accounts: [{ id: 1, name: "Spending", type: "debit", sortOrder: 1, isActive: true, source: "up", externalKind: "TRANSACTIONAL", balance: 1, syncEnabled: true }],
      categories: [category(1, "Good Life"), category(2, "Pubs & Bars", 1), category(3, "Groceries")],
      transactions: [txn(1, 2, "Pubs & Bars", -10), txn(2, 3, "Groceries", -20), txn(3, 3, "Groceries", 100)],
      accountSelection: "all",
      ready: true,
    })
    data.commitFilter("desc:T")
    ui.setTimeframe({ ...ui.state.timeframe, family: "custom", custom: { start: "2026-10-01", end: "2026-10-31" } })
    ui.setState({ focusedSection: "ov.categories", overviewCategoryCursor: 0 })
    // Lines: Groceries, Good Life, Pubs & Bars (largest group first).
    handleKey(ui, key({ name: "j" }), data)
    handleKey(ui, key({ name: "return" }), data)
    expect(ui.state.activeTab).toBe("manager")
    expect(data.state.filterQuery).toContain('(cat:"Good Life" OR cat:"Pubs & Bars")')
    expect(data.scopedTransactions().map((t) => t.id)).toEqual([1])
    expect(footerHints("manager.txns", ui.state).some((h) => h.key === "esc" && h.desc === "back")).toBe(true)
    handleKey(ui, key({ name: "escape" }), data)
    expect(ui.state.activeTab).toBe("overview")
    expect(ui.state.focusedSection).toBe("ov.categories")
    expect(data.state.filterQuery).toBe("desc:T")
    expect(ui.state.drillReturn).toBeNull()
    data.clearFilter()
  })

  test("0 returns to now for the range's kind; c to this cycle", () => {
    ui.setState({ focusedSection: "none" })
    const now = new Date()
    ui.setTimeframe(applyChip(ui.state.timeframe, LOOKBACKS.length + PERIODS.indexOf("month"), now))
    const thisMonth = ui.state.timeframe.periodAnchor
    handleKey(ui, key({ name: "[", sequence: "[" }), data)
    expect(ui.state.timeframe.periodAnchor).not.toBe(thisMonth)
    handleKey(ui, key({ name: "0", sequence: "0" }), data)
    expect(ui.state.timeframe).toMatchObject({ family: "period", period: "month", periodAnchor: thisMonth })
    handleKey(ui, key({ name: "c", sequence: "c" }), data)
    expect(ui.state.timeframe).toMatchObject({ family: "period", period: "cycle" })
  })

  test("/ on the Overview opens the Transactions filter", () => {
    ui.setState({ focusedSection: "none" })
    handleKey(ui, key({ name: "/", sequence: "/" }), data)
    expect(ui.state.activeTab).toBe("manager")
    expect(ui.state.filterMode).toBe(true)
    handleKey(ui, key({ name: "escape" }), data)
  })

  test("the Custom chip asks for dates and applies a valid range", () => {
    ui.setTimeframe({ ...ui.state.timeframe, family: "custom", custom: { start: "2026-10-01", end: "2026-10-31" } })
    ui.setState({ focusedSection: "ov.range", dashChipCursor: CUSTOM_CHIP })
    handleKey(ui, key({ name: "return" }), data)
    expect(ui.activeScope()).toBe("overview.custom")
    expect(ui.state.customEdit?.start.value).toBe("2026-10-01")
    handleKey(ui, key({ name: "tab" }), data)
    handleKey(ui, key({ name: "backspace" }), data)
    handleKey(ui, key({ name: "backspace" }), data)
    handleKey(ui, key({ name: "1" }), data)
    handleKey(ui, key({ name: "5" }), data)
    handleKey(ui, key({ name: "return" }), data)
    expect(ui.state.customEdit).toBeNull()
    expect(ui.state.timeframe).toMatchObject({ family: "custom", custom: { start: "2026-10-01", end: "2026-10-15" } })
    // An end before the start is refused with a message.
    handleKey(ui, key({ name: "return" }), data)
    handleKey(ui, key({ name: "tab" }), data)
    handleKey(ui, key({ name: "u", ctrl: true }), data)
    for (const ch of "2026-09-01") handleKey(ui, key({ name: ch, sequence: ch }), data)
    handleKey(ui, key({ name: "return" }), data)
    expect(ui.state.customEdit?.error).toBe("End is before start")
    handleKey(ui, key({ name: "escape" }), data)
    expect(ui.state.timeframe.custom).toEqual({ start: "2026-10-01", end: "2026-10-15" })
  })

  test("overview date chip apply sets timeframe", () => {
    ui.setState({ focusedSection: "ov.range", dashChipCursor: 0 })
    data.setState({
      transactions: [
        {
          id: 1,
          dateRaw: "x",
          dateISO: "2026-02-10",
          amount: -1,
          description: "x",
          categoryId: null,
          categoryName: "Uncategorised",
          categoryColor: "#7f849c",
          notes: "",
          importId: null,
          accountId: 1,
          accountName: "A",
          tagNames: [],
          tagColors: [],
          tagIds: [], source: "csv" as const, status: null, transferAccountId: null, internal: false, excluded: false,
        },
      ],
      ready: true,
    })
    handleKey(ui, key({ name: "return" }), data)
    expect(ui.state.timeframe.family).toBe("lookback")
    expect(ui.state.timeframe.lookback).toBe("1M")
  })

  test("footer hints change with scope", () => {
    expect(footerHints("jump").some((h) => h.desc === "cancel")).toBe(true)
    expect(footerHints("manager.txns").some((h) => h.key === "j/k")).toBe(true)
    expect(footerHints("overview.range").some((h) => h.desc === "apply")).toBe(true)
  })

  test("settings database owns i and clear confirmation requires del", () => {
    data.init(":memory:")
    ui.switchTab("settings")
    ui.activateSettings("database")
    handleKey(ui, key({ name: "i" }), data)
    expect(ui.state.importStage).toBe("files")
    handleKey(ui, key({ name: "escape" }), data)
    handleKey(ui, key({ name: "c" }), data)
    expect(ui.state.settingsConfirm?.kind).toBe("clearData")
    handleKey(ui, key({ name: "c" }), data)
    expect(ui.state.settingsConfirm?.kind).toBe("clearData")
    handleKey(ui, key({ name: "delete" }), data)
    expect(ui.state.settingsConfirm).toBeNull()
  })

  test("filter edits at the caret keep live preview, parse status and rows in sync", () => {
    ui.switchTab("manager")
    const txn = (id: number, amount: number) => ({
      id, amount, dateRaw: "x", dateISO: "2026-01-01", description: "filter row", categoryId: null, categoryName: "U", categoryColor: "#7f849c",
      notes: "", importId: null, accountId: 1, accountName: "A", tagNames: [], tagColors: [], tagIds: [],
      source: "csv" as const, status: null, transferAccountId: null, internal: false, excluded: false,
    })
    data.setState({ transactions: [txn(1, -120), txn(2, -10)], accountSelection: "all", accounts: [
      { id: 1, name: "A", type: "debit", sortOrder: 0, isActive: true, source: "csv", externalKind: null, balance: null, syncEnabled: true },
    ] })
    ui.openFilter("amt:-10")
    expect(ui.state.filterCaret).toBe(7)
    handleKey(ui, key({ name: "left" }), data)
    handleKey(ui, key({ name: "2" }), data)
    expect(ui.state.filterDraft).toBe("amt:-120")
    expect(ui.state.filterCaret).toBe(7)
    expect(data.state.filterQuery).toBe("amt:-120")
    expect(data.filterPreview()).toBe("amt:=-120")
    expect(data.state.filterErr).toBe("")
    expect(data.scopedTransactions().map((row) => row.id)).toEqual([1])
    expect(ui.state.managerCursor).toBe(0)
    handleKey(ui, key({ name: "delete" }), data)
    expect(data.state.filterQuery).toBe("amt:-12")
    handleKey(ui, key({ name: "home" }), data)
    handleKey(ui, key({ name: "k", ctrl: true }), data)
    expect(data.state.filterQuery).toBe("")
    ui.closeFilter(false)
    ui.openFilter("desc:seed")
    expect(ui.state.filterCaret).toBe(9)
    handleKey(ui, key({ name: "escape" }), data)
  })

  test("notes seed at the end, edit in the middle, save locally and clear the caret", () => {
    const db = openDb(":memory:")
    try {
      db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, notes, source) VALUES (901, 'x', '2026-01-01', -1, 'local', 'cofee', 'csv')").run()
      data.setState({ transactions: loadTransactions(db) })
      const local = { ...data, updateTransactionNotes: (id: number, notes: string) => setTransactionNotes(db, id, notes) }
      ui.switchTab("manager")
      ui.setState({ detailId: 901, detailNotesCaret: 0 })
      handleKey(ui, key({ name: "n" }), local)
      expect(ui.state.detailNotesCaret).toBe(5)
      handleKey(ui, key({ name: "left" }), local)
      handleKey(ui, key({ name: "left" }), local)
      handleKey(ui, key({ name: "f" }), local)
      expect(ui.state.detailNotesDraft).toBe("coffee")
      handleKey(ui, key({ name: "return" }), local)
      expect(loadTransactionDetail(db, 901)?.notes).toBe("coffee")
      expect(ui.state.detailNotesCaret).toBe(0)
      expect(ui.state.detailNotesEditing).toBe(false)
    } finally {
      ui.setState({ detailId: null, detailNotesEditing: false })
      db.close()
    }
  })

  test("settings text arrows move the caret; choices and toggles still change values", () => {
    ui.switchTab("settings")
    ui.openSettingsEditor("category", null, { ...ui.state.settingsDraft, name: "cofee", color: "#123456" })
    expect(ui.state.settingsCaret).toBe(5)
    handleKey(ui, key({ name: "left" }), data)
    handleKey(ui, key({ name: "left" }), data)
    handleKey(ui, key({ name: "f" }), data)
    expect(ui.state.settingsDraft.name).toBe("coffee")
    expect(ui.state.settingsEditField).toBe(0)
    handleKey(ui, key({ name: "right" }), data)
    expect(ui.state.settingsCaret).toBe(5)
    handleKey(ui, key({ name: "tab" }), data)
    expect(ui.state.settingsCaret).toBe(7)
    handleKey(ui, key({ name: "down" }), data)
    const before = ui.state.settingsDraft.notSpending
    handleKey(ui, key({ name: "left" }), data)
    expect(ui.state.settingsDraft.notSpending).toBe(!before)
    handleKey(ui, key({ name: "right" }), data)
    expect(ui.state.settingsDraft.notSpending).toBe(before)
    handleKey(ui, key({ name: "up" }), data)
    expect(ui.state.settingsCaret).toBe(7)
    handleKey(ui, key({ name: "tab", shift: true }), data)
    expect(ui.state.settingsCaret).toBe(6)
    ui.openSettingsEditor("cycle", null, { ...ui.state.settingsDraft, unit: "month", anchor: "calendar" })
    handleKey(ui, key({ name: "left" }), data)
    expect(ui.state.settingsDraft.unit).toBe("fortnight")
    handleKey(ui, key({ name: "right" }), data)
    expect(ui.state.settingsDraft.unit).toBe("month")
    ui.openSettingsEditor("filter", null, { ...ui.state.settingsDraft, id: "seed-id" })
    expect(ui.state.settingsCaret).toBe(7)
    handleKey(ui, key({ name: "escape" }), data)
  })

  test("profile text fields reset the caret on focus; all four choice fields keep their bindings", () => {
    ui.switchTab("settings")
    ui.openProfileEditor({ ...ui.state.importProfileDraft, id: "cofee", name: "profile", accountType: "debit", hasHeader: true, descriptionJoin: false, dateFormat: "DMY" }, null)
    expect(ui.state.importProfileCaret).toBe(5)
    handleKey(ui, key({ name: "up" }), data)
    handleKey(ui, key({ name: "down" }), data)
    expect(ui.state.importProfileField).toBe(0)
    expect(ui.state.importProfileCaret).toBe(5)
    handleKey(ui, key({ name: "left" }), data)
    handleKey(ui, key({ name: "left" }), data)
    handleKey(ui, key({ name: "f" }), data)
    expect(ui.state.importProfileDraft.id).toBe("coffee")
    expect(ui.state.importProfileField).toBe(0)
    handleKey(ui, key({ name: "tab" }), data)
    expect(ui.state.importProfileCaret).toBe(7)
    handleKey(ui, key({ name: "tab", shift: true }), data)
    expect(ui.state.importProfileCaret).toBe(6)
    for (const field of [3, 5, 10, 12]) {
      ui.setState({ importProfileField: field })
      const before = { ...ui.state.importProfileDraft }
      handleKey(ui, key({ name: "backspace" }), data)
      handleKey(ui, key({ name: "x" }), data)
      expect({ ...ui.state.importProfileDraft }).toEqual(before)
      handleKey(ui, key({ name: "left" }), data)
      expect({ ...ui.state.importProfileDraft }).not.toEqual(before)
      handleKey(ui, key({ name: "right" }), data)
      for (const name of ["h", "l", "space"]) {
        const before = { ...ui.state.importProfileDraft }
        handleKey(ui, key({ name, sequence: name === "space" ? " " : name }), data)
        expect({ ...ui.state.importProfileDraft }).not.toEqual(before)
      }
    }
    ui.cancelImport()
  })

  test("import path and reset confirmation edit at the caret and reset on open or cancel", () => {
    ui.switchTab("settings")
    ui.beginImport("/csv", [])
    handleKey(ui, key({ name: "p" }), data)
    expect(ui.state.importPathCaret).toBe(0)
    for (const name of "ab.csv") handleKey(ui, key({ name }), data)
    handleKey(ui, key({ name: "home" }), data)
    handleKey(ui, key({ name: "right" }), data)
    handleKey(ui, key({ name: "x" }), data)
    expect(ui.state.importPath).toBe("axb.csv")
    handleKey(ui, key({ name: "delete" }), data)
    expect(ui.state.importPath).toBe("ax.csv")
    handleKey(ui, key({ name: "return" }))
    expect(ui.state.importPath).toBe("/csv/ax.csv")
    expect(ui.state.importPathCaret).toBe(ui.state.importPath.length)
    ui.cancelImport()
    expect(ui.state.importPathCaret).toBe(0)
    ui.activateSettings("database")
    handleKey(ui, key({ name: "x" }), data)
    expect(ui.state.factoryResetCaret).toBe(0)
    for (const name of "REST") handleKey(ui, key({ name }), data)
    handleKey(ui, key({ name: "left" }), data)
    handleKey(ui, key({ name: "e", sequence: "E" }), data)
    expect(ui.state.factoryResetDraft).toBe("RESET")
    handleKey(ui, key({ name: "escape" }), data)
    expect(ui.state.factoryResetCaret).toBe(0)
    expect(ui.state.factoryResetDraft).toBe("")
  })

  test("command letters and space stay literal in all six text contexts", () => {
    const contexts = [
      { open: () => ui.openFilter(), value: () => ui.state.filterDraft },
      { open: () => ui.setState({ detailId: 901, detailNotesEditing: true, detailNotesDraft: "", detailNotesCaret: 0 }), value: () => ui.state.detailNotesDraft },
      { open: () => ui.openSettingsEditor("category", null, { ...ui.state.settingsDraft, name: "" }), value: () => ui.state.settingsDraft.name },
      { open: () => { ui.beginImport("/csv", []); handleKey(ui, key({ name: "p" })) }, value: () => ui.state.importPath },
      { open: () => ui.openProfileEditor({ ...ui.state.importProfileDraft, id: "" }, null), value: () => ui.state.importProfileDraft.id },
      { open: () => { ui.activateSettings("database"); handleKey(ui, key({ name: "x" })) }, value: () => ui.state.factoryResetDraft },
    ]
    for (const context of contexts) {
      ui.switchTab("settings")
      ui.setState({ detailId: null, detailNotesEditing: false })
      context.open()
      for (const name of "hljknx123") handleKey(ui, key({ name }))
      handleKey(ui, key({ name: "space", sequence: " " }))
      expect(context.value()).toBe("hljknx123 ")
      handleKey(ui, key({ name: "backspace" }))
      expect(context.value()).toBe("hljknx123")
      handleKey(ui, key({ name: "escape" }))
    }
    ui.setState({ detailId: null, detailNotesEditing: false })
    ui.switchTab("overview")
  })

})
