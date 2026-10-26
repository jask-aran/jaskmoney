import { describe, expect, test, beforeEach } from "bun:test"
import type { KeyEvent } from "@opentui/core"
import { handleKey, footerHints } from "./keys"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"

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
    ui.switchTab("dashboard")
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
    expect(ui.state.activeTab).toBe("spending")
    handleKey(ui, key({ name: "3" }), data)
    expect(ui.state.activeTab).toBe("manager")
    handleKey(ui, key({ name: "4" }), data)
    expect(ui.state.activeTab).toBe("settings")
    handleKey(ui, key({ name: "1" }), data)
    expect(ui.state.activeTab).toBe("dashboard")
  })

  test("tab cycles", () => {
    handleKey(ui, key({ name: "tab" }), data)
    expect(ui.state.activeTab).toBe("spending")
    handleKey(ui, key({ name: "tab", shift: true }), data)
    expect(ui.state.activeTab).toBe("dashboard")
  })

  test("jump mode open, target, cancel", () => {
    handleKey(ui, key({ name: "v" }), data)
    expect(ui.state.jumpMode).toBe(true)
    handleKey(ui, key({ name: "d" }), data)
    expect(ui.state.jumpMode).toBe(false)
    expect(ui.state.focusedSection).toBe("dash.date")

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
      source: "up" as const, status: null, transferAccountId: null, internal: false,
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
    // The dashboard's spending set ignores the manager selection.
    expect(data.spendingTransactions().map((t) => t.id)).toEqual([1])
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
      tagColors: [], tagIds: [], source: "up" as const, status: null, transferAccountId: null, internal: false,
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

  test("spending tab: j/k pick a merchant, enter opens its transactions in the Manager", () => {
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`
    const txn = (id: number, description: string, amount: number) => ({
      id, dateRaw: "x", dateISO: iso, amount, description, categoryId: 1, categoryName: "U", categoryColor: "#7f849c",
      notes: "", importId: null, accountId: 1, accountName: "Spending", tagNames: [], tagColors: [], tagIds: [],
      source: "up" as const, status: null, transferAccountId: null, internal: false,
    })
    data.setState({
      accounts: [{ id: 1, name: "Spending", type: "debit" as const, sortOrder: 1, isActive: true, source: "up" as const, externalKind: "TRANSACTIONAL", balance: 1, syncEnabled: true }],
      transactions: [txn(1, "Big Shop", -90), txn(2, 'Cafe "Ripple"', -10)],
      accountSelection: 1,
      ready: true,
    })
    ui.setTimeframe({ ...ui.state.timeframe, family: "period", period: "month", periodAnchor: iso })
    ui.switchTab("spending")
    ui.setState({ merchantCursor: 0 })
    handleKey(ui, key({ name: "j" }), data)
    expect(ui.state.merchantCursor).toBe(1)
    handleKey(ui, key({ name: "j" }), data)
    expect(ui.state.merchantCursor).toBe(1)
    handleKey(ui, key({ name: "return" }), data)
    expect(ui.state.activeTab).toBe("manager")
    expect(data.state.accountSelection).toBe("all")
    expect(data.state.filterQuery).toBe('desc:"Cafe \\"Ripple\\""')
    expect(data.scopedTransactions().map((t) => t.id)).toEqual([2])
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
          tagIds: [], source: "csv" as const, status: null, transferAccountId: null, internal: false,
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

  test("dashboard date chip apply sets timeframe", () => {
    ui.switchTab("dashboard")
    ui.setState({ focusedSection: "dash.date", dashChipCursor: 0 })
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
          tagIds: [], source: "csv" as const, status: null, transferAccountId: null, internal: false,
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
    expect(footerHints("dashboard.date").some((h) => h.desc === "apply")).toBe(true)
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
})
