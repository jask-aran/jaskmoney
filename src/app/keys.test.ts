import { DATABASE_ROWS } from "../state/databaseRows"
import { describe, expect, test, beforeEach } from "bun:test"
import { accountRows, accountStacks, spendingScope } from "../domain/accountTree"
import { CUSTOM_CHIP, LOOKBACKS, PERIODS, applyChip } from "../domain/timeframe"
import { handleKey, footerHints } from "./keys"
import { CHART_VIEWS, ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { loadTransactions, loadTransactionDetail, setTransactionNotes } from "../db/client"
import { account, category, transaction } from "../testing/fixtures"
import { key } from "../testing/keys"
import { testDb, testEnv } from "../testing/scoped"

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
    handleKey(ui, key("2"), data)
    expect(ui.state.activeTab).toBe("manager")
    handleKey(ui, key("3"), data)
    expect(ui.state.activeTab).toBe("settings")
    handleKey(ui, key("1"), data)
    expect(ui.state.activeTab).toBe("overview")
  })

  test("tab cycles", () => {
    handleKey(ui, key("tab"), data)
    expect(ui.state.activeTab).toBe("manager")
    handleKey(ui, key("tab", { shift: true }), data)
    expect(ui.state.activeTab).toBe("overview")
  })

  test("jump mode open, target, cancel", () => {
    handleKey(ui, key("v"), data)
    expect(ui.state.jumpMode).toBe(true)
    handleKey(ui, key("d"), data)
    expect(ui.state.jumpMode).toBe(false)
    expect(ui.state.focusedSection).toBe("ov.range")

    handleKey(ui, key("v"), data)
    handleKey(ui, key("escape"), data)
    expect(ui.state.jumpMode).toBe(false)
  })

  test("the accounts pane drives the Transactions table, not the Overview", () => {
    const txn = (id: number, accountId: number) => transaction({
      id, accountId, dateISO: `2026-02-0${id}`, amount: -id, description: `T${id}`, categoryId: 1, categoryName: "U", accountName: "",
    })
    data.setState({
      accounts: [
        account({ id: 1, name: "Spending", balance: 100 }),
        account({ id: 2, name: "Holiday", externalKind: "SAVER", balance: 200 }),
        account({ id: 3, name: "General", externalKind: "SAVER", balance: 300 }),
        account({ id: 4, name: "Bills", source: "csv", externalKind: null, balance: -50 }),
      ],
      transactions: [txn(1, 1), txn(2, 2), txn(3, 3), txn(4, 4)],
      accountSelection: "all",
      ready: true,
    })
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.accounts" })
    const shown = () => data.scopedTransactions().map((t) => t.id).sort()

    // A stack per bank, after one for all spending; savers are one row.
    expect(accountStacks(data.state.accounts).map((s) => [s.label, s.net, s.rows.map((r) => r.label)])).toEqual([
      ["All accounts", 550, ["All spending"]],
      ["Up (API)", 600, ["Spending", "Savers"]],
      ["CSV import", -50, ["Bills"]],
    ])
    expect(shown()).toEqual([1, 4])
    handleKey(ui, key("j"), data)
    expect(data.state.accountSelection).toBe(1)
    handleKey(ui, key("j"), data)
    expect(data.state.accountSelection).toBe("savers")
    expect(shown()).toEqual([2, 3])
    // h/l: the first row of the stack beside.
    handleKey(ui, key("l"), data)
    expect(data.state.accountSelection).toBe(4)
    handleKey(ui, key("l"), data)
    expect(data.state.accountSelection).toBe(4)
    handleKey(ui, key("h"), data)
    expect(data.state.accountSelection).toBe(1)
    handleKey(ui, key("k"), data)
    expect(data.state.accountSelection).toBe("all")
    // Savers selected: the Overview covers every spending account.
    data.setAccountSelection("savers")
    expect(spendingScope(data.state.accounts, data.state.accountSelection).accounts.map((a) => a.id)).toEqual([1, 4])
    // Data actions only for a row with one account behind it.
    handleKey(ui, key("d"), data)
    expect(ui.state.accountActionId).toBeNull()
    handleKey(ui, key("k"), data)
    handleKey(ui, key("d"), data)
    expect(ui.state.accountActionId).toBe(1)
    ui.setState({ accountActionId: null })
    handleKey(ui, key("return"), data)
    expect(ui.state.focusedSection).toBe("mgr.transactions")
    // A saver chosen elsewhere (a stored selection) shows as Savers.
    data.setAccountSelection(2)
    expect(data.state.accountSelection).toBe("savers")
    data.setState({ accountSelection: "all" })
  })

  test("with one spending account, its row is all spending", () => {
    data.setState({
      accounts: [account({ id: 1, name: "Spending" }), account({ id: 2, name: "Holiday", externalKind: "SAVER" })],
      accountSelection: "all",
      ready: true,
    })
    expect(accountStacks(data.state.accounts).map((s) => s.label)).toEqual(["Up (API)"])
    expect(accountRows(data.state.accounts).map((r) => [r.selection, r.accountId])).toEqual([["all", 1], ["savers", null]])
    data.setAccountSelection(1)
    expect(data.state.accountSelection).toBe("all")
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.accounts" })
    handleKey(ui, key("d"), data)
    expect(ui.state.accountActionId).toBe(1)
    ui.setState({ accountActionId: null })
  })

  test("? in the filter is a question in words: no live filtering while typing; enter asks and keeps the draft open", () => {
    testEnv("JASKMONEY_JEV_TOKEN", "")
    testEnv("JASKMONEY_CF_TOKEN", "")
    data.setState({ accounts: [account({ name: "A" })], transactions: [transaction({ id: 1, description: "Coffee" })], accountSelection: "all", ready: true })
    data.clearFilter()
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions" })
    handleKey(ui, key("/"), data)
    for (const ch of "?zzz") handleKey(ui, key(ch), data)
    expect(data.state.filterQuery).toBe("")
    expect(data.scopedTransactions()).toHaveLength(1)
    handleKey(ui, key("return"), data)
    expect(ui.state.filterMode).toBe(true)
    expect(ui.state.filterDraft).toBe("?zzz")
    expect(ui.state.status).toContain("Smart search needs Jev")
    expect(footerHints(ui.activeScope()).some((h) => h.key === "?…")).toBe(true)
    handleKey(ui, key("escape"), data)
  })

  test("transaction detail opens on enter, owns input, and targets its own row", () => {
    const txn = (id: number) => transaction({
      id, dateISO: `2026-02-0${id}`, amount: -id, description: `T${id}`, categoryId: 1, categoryName: "U", notes: id === 2 ? "kept" : "",
    })
    data.setState({
      accounts: [account({ name: "A", balance: 1 })],
      transactions: [txn(3), txn(2), txn(1)],
      accountSelection: "all",
      ready: true,
    })
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0, selectedIds: { 1: true } })
    handleKey(ui, key("return"), data)
    expect(ui.state.detailId).toBe(3)
    expect(ui.activeScope()).toBe("manager.detail")
    // The detail row wins over the selection for pickers.
    expect(ui.targetIds(data.scopedTransactions())).toEqual([3])
    // j browses to the next row without closing.
    handleKey(ui, key("j"), data)
    expect(ui.state.detailId).toBe(2)
    // Tab keys are swallowed while the modal is open.
    handleKey(ui, key("1"), data)
    expect(ui.state.activeTab).toBe("manager")
    // n edits notes starting from the current value; printable keys are text.
    handleKey(ui, key("n"), data)
    expect(ui.activeScope()).toBe("manager.detail.notes")
    expect(ui.state.detailNotesDraft).toBe("kept")
    handleKey(ui, key("j"), data)
    expect(ui.state.detailNotesDraft).toBe("keptj")
    handleKey(ui, key("escape"), data)
    expect(ui.state.detailNotesEditing).toBe(false)
    handleKey(ui, key("escape"), data)
    expect(ui.state.detailId).toBeNull()
    expect(ui.targetIds(data.scopedTransactions())).toEqual([1])
    ui.setState({ selectedIds: {} })
  })

  test("transactions: m groups the filtered rows by merchant; enter narrows the filter to one", () => {
    const iso = "2026-10-01"
    const txn = (id: number, description: string, amount: number) => transaction({
      id, description, amount, dateISO: iso, categoryId: 1, categoryName: "U", accountName: "Spending",
    })
    data.setState({
      accounts: [account({ name: "Spending", balance: 1 })],
      transactions: [txn(1, "Big Shop", -90), txn(2, 'Cafe "Ripple"', -10), txn(3, 'Cafe "Ripple"', -5)],
      accountSelection: "all",
      ready: true,
    })
    data.clearFilter()
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions", txnView: "rows" })
    handleKey(ui, key("m"), data)
    expect(ui.activeScope()).toBe("manager.merchants")
    // Biggest spend first: Big Shop, then the cafe.
    handleKey(ui, key("j"), data)
    expect(ui.state.merchantCursor).toBe(1)
    handleKey(ui, key("c"), data)
    expect([...ui.state.pickerTargets].sort()).toEqual([2, 3])
    handleKey(ui, key("escape"), data)
    handleKey(ui, key("return"), data)
    expect(ui.state.txnView).toBe("rows")
    expect(data.state.filterQuery).toBe('desc:"Cafe \\"Ripple\\""')
    expect(data.scopedTransactions().map((t) => t.id).sort()).toEqual([2, 3])
    data.clearFilter()
  })


  test("manager cursor moves with j/k", () => {
    data.setState({
      transactions: [1, 2, 3].map((id) => transaction({
        id, dateISO: `2026-02-0${id}`, amount: -id, categoryId: 1, categoryName: "U", source: "csv", status: null,
      })),
      accounts: [account({ name: "A", type: "credit", source: "csv", externalKind: null, balance: null })],
      ready: true,
    })

    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0 })
    handleKey(ui, key("j"), data)
    expect(ui.state.managerCursor).toBe(1)
    handleKey(ui, key("j"), data)
    expect(ui.state.managerCursor).toBe(2)
    handleKey(ui, key("k"), data)
    expect(ui.state.managerCursor).toBe(1)
    handleKey(ui, key("g"), data)
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

    handleKey(ui, key("escape"), data)
    expect(ui.state.selectedIds).toEqual({})
    expect(ui.state.rangeSelecting).toBe(false)
    expect(ui.state.status).toBe("Selection cleared")

    data.setFilterLive("coffee")
    handleKey(ui, key("escape"), data)
    expect(data.state.filterQuery).toBe("")
    expect(ui.state.status).toBe("Filter cleared")
  })

  test("overview h/l step the top or focused chart; H/L the bottom one", () => {
    ui.setState({ focusedSection: "none", chartViews: [0, 4] })
    handleKey(ui, key("l"), data)
    expect(ui.state.chartViews).toEqual([1, 4])
    handleKey(ui, key("h"), data)
    // From the first view, h wraps to the last.
    handleKey(ui, key("h"), data)
    expect(ui.state.chartViews).toEqual([CHART_VIEWS.length - 1, 4])
    handleKey(ui, key("l", { shift: true, sequence: "L" }), data)
    expect(ui.state.chartViews).toEqual([CHART_VIEWS.length - 1, 5])
    ui.setState({ focusedSection: "ov.chart2" })
    handleKey(ui, key("h"), data)
    expect(ui.state.chartViews).toEqual([CHART_VIEWS.length - 1, 4])
  })

  test("drill-down: enter on a category line opens its transactions; esc comes back", () => {
    const txn = (id: number, categoryId: number, categoryName: string, amount: number) => transaction({
      id, categoryId, categoryName, amount, dateISO: "2026-10-10", description: `T${id}`, accountName: "Spending",
    })
    data.setState({
      accounts: [account({ name: "Spending", balance: 1 })],
      categories: [category({ id: 1, name: "Good Life" }), category({ id: 2, name: "Pubs & Bars", parentId: 1 }), category({ id: 3, name: "Groceries" })],
      // A $5 Groceries refund: Groceries nets $15, still the largest.
      transactions: [txn(1, 2, "Pubs & Bars", -10), txn(2, 3, "Groceries", -20), txn(3, 3, "Groceries", 5)],
      accountSelection: "all",
      ready: true,
    })
    data.commitFilter("desc:T")
    ui.setTimeframe({ ...ui.state.timeframe, family: "custom", custom: { start: "2026-10-01", end: "2026-10-31" } })
    ui.setState({ focusedSection: "ov.categories", overviewCategoryCursor: 0 })
    // Lines: Groceries, Good Life, Pubs & Bars (largest group first).
    handleKey(ui, key("j"), data)
    handleKey(ui, key("return"), data)
    expect(ui.state.activeTab).toBe("manager")
    expect(data.state.filterQuery).toContain('(cat:"Good Life" OR cat:"Pubs & Bars")')
    expect(data.scopedTransactions().map((t) => t.id)).toEqual([1])
    expect(footerHints("manager.txns", ui.state).some((h) => h.key === "esc" && h.desc === "back")).toBe(true)
    handleKey(ui, key("escape"), data)
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
    handleKey(ui, key("["), data)
    expect(ui.state.timeframe.periodAnchor).not.toBe(thisMonth)
    handleKey(ui, key("0"), data)
    expect(ui.state.timeframe).toMatchObject({ family: "period", period: "month", periodAnchor: thisMonth })
    handleKey(ui, key("c"), data)
    expect(ui.state.timeframe).toMatchObject({ family: "period", period: "cycle" })
  })

  test("z runs balance charts from $0 and back; its hint shows with a balance chart", () => {
    ui.setState({ focusedSection: "none", chartViews: [0, 1] })
    expect(footerHints("overview", ui.state).some((h) => h.key === "z")).toBe(false)
    ui.setState({ chartViews: [0, 4] })
    expect(footerHints("overview", ui.state).some((h) => h.key === "z")).toBe(true)
    const before = data.state.uiPrefs.zeroAxis === true
    handleKey(ui, key("z"), data)
    expect(data.state.uiPrefs.zeroAxis).toBe(!before)
    handleKey(ui, key("z"), data)
    expect(data.state.uiPrefs.zeroAxis).toBe(before)
  })

  test("/ on the Overview opens the Transactions filter", () => {
    ui.setState({ focusedSection: "none" })
    handleKey(ui, key("/"), data)
    expect(ui.state.activeTab).toBe("manager")
    expect(ui.state.filterMode).toBe(true)
    handleKey(ui, key("escape"), data)
  })

  test("the Custom chip asks for dates and applies a valid range", () => {
    ui.setTimeframe({ ...ui.state.timeframe, family: "custom", custom: { start: "2026-10-01", end: "2026-10-31" } })
    ui.setState({ focusedSection: "ov.range", dashChipCursor: CUSTOM_CHIP })
    handleKey(ui, key("return"), data)
    expect(ui.activeScope()).toBe("overview.custom")
    expect(ui.state.customEdit?.start.value).toBe("2026-10-01")
    handleKey(ui, key("tab"), data)
    handleKey(ui, key("backspace"), data)
    handleKey(ui, key("backspace"), data)
    handleKey(ui, key("1"), data)
    handleKey(ui, key("5"), data)
    handleKey(ui, key("return"), data)
    expect(ui.state.customEdit).toBeNull()
    expect(ui.state.timeframe).toMatchObject({ family: "custom", custom: { start: "2026-10-01", end: "2026-10-15" } })
    // An end before the start is refused with a message.
    handleKey(ui, key("return"), data)
    handleKey(ui, key("tab"), data)
    handleKey(ui, key("u", { ctrl: true }), data)
    for (const ch of "2026-09-01") handleKey(ui, key(ch), data)
    handleKey(ui, key("return"), data)
    expect(ui.state.customEdit?.error).toBe("End is before start")
    handleKey(ui, key("escape"), data)
    expect(ui.state.timeframe.custom).toEqual({ start: "2026-10-01", end: "2026-10-15" })
  })

  test("overview date chip apply sets timeframe", () => {
    ui.setState({ focusedSection: "ov.range", dashChipCursor: 0 })
    data.setState({
      transactions: [transaction({ dateISO: "2026-02-10", amount: -1, source: "csv", status: null })],
      ready: true,
    })
    handleKey(ui, key("return"), data)
    expect(ui.state.timeframe.family).toBe("lookback")
    expect(ui.state.timeframe.lookback).toBe("1M")
  })

  test("footer hints change with scope", () => {
    expect(footerHints("jump").some((h) => h.desc === "cancel")).toBe(true)
    expect(footerHints("manager.txns").some((h) => h.key === "j/k")).toBe(true)
    expect(footerHints("overview.range").some((h) => h.desc === "apply")).toBe(true)
  })

  test("settings database is rows: enter imports; clear data is enter twice, and a move disarms it", () => {
    data.init(":memory:")
    ui.switchTab("settings")
    ui.activateSettings("database")
    ui.setState({ databaseCursor: 0 })
    handleKey(ui, key("return"), data)
    expect(ui.state.importStage).toBe("files")
    handleKey(ui, key("escape"), data)
    ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("clearData") })
    handleKey(ui, key("return"), data)
    expect(ui.state.armed).toMatchObject({ kind: "clearData", with: "enter" })
    expect(ui.state.status).toBe("Press enter again to clear all transactions and imports")
    handleKey(ui, key("k"), data)
    expect(ui.state.armed).toBeNull()
    handleKey(ui, key("j"), data)
    handleKey(ui, key("return"), data)
    handleKey(ui, key("return"), data)
    expect(ui.state.armed).toBeNull()
    expect(ui.state.status).toBe("Transaction and import data cleared")
  })

  test("Up: Accounts opens the accounts dialog; enter switches sync on at once, and off on a second enter (it removes the account's rows)", () => {
    data.init(":memory:")
    const db = data.getDb()!
    db.query("INSERT INTO accounts (id, name, type, source, sync_enabled) VALUES (300, 'Saver', 'debit', 'up', 0)").run()
    data.refresh()
    ui.switchTab("settings")
    ui.activateSettings("up")
    // Rows: token, sync, accounts.
    ui.setState({ upCursor: 2 })
    handleKey(ui, key("return"), data)
    expect(ui.state.upAccounts).toEqual({ cursor: 0 })
    expect(ui.activeScope()).toBe("settings.upAccounts")
    handleKey(ui, key("return"), data)
    expect(data.state.syncAccounts[0]!.syncEnabled).toBe(true)
    handleKey(ui, key("return"), data)
    expect(ui.state.armed).toMatchObject({ kind: "desyncAccount", id: 300, with: "enter" })
    expect(data.state.syncAccounts[0]!.syncEnabled).toBe(true)
    handleKey(ui, key("return"), data)
    expect(ui.state.armed).toBeNull()
    expect(data.state.syncAccounts[0]!.syncEnabled).toBe(false)
    expect(footerHints("settings.upAccounts").map((h) => `${h.key} ${h.desc}`)).toContain("enter sync on/off")
    handleKey(ui, key("escape"), data)
    expect(ui.state.upAccounts).toBeNull()
    expect(ui.activeScope()).toBe("settings.up")
  })

  test("Budgets: the cycle is the first row (enter edits it); budgets follow and delete on del del", () => {
    data.init(":memory:")
    ui.switchTab("settings")
    ui.activateSettings("budgets")
    ui.setState({ budgetCursor: 0 })
    handleKey(ui, key("return"), data)
    expect(ui.state.settingsEditor).toBe("cycle")
    ui.setState({ settingsEditor: null })
    data.setBudget({ kind: "overall" }, 500)
    handleKey(ui, key("j"), data)
    expect(ui.state.budgetCursor).toBe(1)
    handleKey(ui, key("delete"), data)
    expect(ui.state.armed?.kind).toBe("budget")
    handleKey(ui, key("delete"), data)
    expect(data.state.budgets).toEqual([])
    expect(footerHints("settings.budgets").some((h) => h.key === "c")).toBe(false)
  })

  test("an import profile deletes on a second del; esc disarms and stays on the list", () => {
    data.init(":memory:")
    data.saveImportProfile({ id: "bank", name: "Bank", account: "A", accountType: "debit", importPrefix: "bank", hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" })
    ui.switchTab("settings")
    ui.activateSettings("database")
    ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("profiles") })
    handleKey(ui, key("return"), data)
    expect(ui.state.importStage).toBe("profile")
    const others = data.state.importProfiles.filter((p) => p.id !== "bank").map((p) => p.id)
    ui.setState({ importProfileCursor: data.state.importProfiles.findIndex((p) => p.id === "bank") })
    handleKey(ui, key("delete"), data)
    expect(ui.state.armed).toMatchObject({ kind: "profile", id: "bank" })
    handleKey(ui, key("escape"), data)
    expect(ui.state.armed).toBeNull()
    expect(ui.state.importStage).toBe("profile")
    handleKey(ui, key("delete"), data)
    handleKey(ui, key("delete"), data)
    expect(ui.state.armed).toBeNull()
    expect(data.state.importProfiles.map((p) => p.id)).toEqual(others)
    expect(ui.state.importStage).toBe("profile")
    ui.cancelImport()
  })

  test("lists: G goes to the bottom, g to the top; an empty list's cursor stays at 0", () => {
    data.init(":memory:")
    ui.switchTab("settings")
    ui.activateSettings("taxonomy", "categories", true)
    const n = data.state.categories.length
    handleKey(ui, key("g", { shift: true, sequence: "G" }), data)
    expect(ui.state.categoryCursor).toBe(n - 1)
    handleKey(ui, key("g"), data)
    expect(ui.state.categoryCursor).toBe(0)
    ui.activateSettings("database")
    ui.beginImport("/nowhere", [])
    for (const k of [key("j"), key("g", { shift: true, sequence: "G" }), key("k")]) {
      handleKey(ui, k, data)
      expect(ui.state.importCursor).toBe(0)
    }
    ui.cancelImport()
  })

  test("filter edits at the caret keep live preview, parse status and rows in sync", () => {
    ui.switchTab("manager")
    const txn = (id: number, amount: number) => transaction({
      id, amount, dateISO: "2026-01-01", description: "filter row", categoryName: "U", source: "csv", status: null,
    })
    data.setState({ transactions: [txn(1, -120), txn(2, -10)], accountSelection: "all", accounts: [
      account({ name: "A", sortOrder: 0, source: "csv", externalKind: null, balance: null }),
    ] })
    ui.openFilter("amt:-10")
    expect(ui.state.filterCaret).toBe(7)
    handleKey(ui, key("left"), data)
    handleKey(ui, key("2"), data)
    expect(ui.state.filterDraft).toBe("amt:-120")
    expect(ui.state.filterCaret).toBe(7)
    expect(data.state.filterQuery).toBe("amt:-120")
    expect(data.filterPreview()).toBe("amt:=-120")
    expect(data.state.filterErr).toBe("")
    expect(data.scopedTransactions().map((row) => row.id)).toEqual([1])
    expect(ui.state.managerCursor).toBe(0)
    handleKey(ui, key("delete"), data)
    expect(data.state.filterQuery).toBe("amt:-12")
    handleKey(ui, key("home"), data)
    handleKey(ui, key("k", { ctrl: true }), data)
    expect(data.state.filterQuery).toBe("")
    ui.closeFilter(false)
    ui.openFilter("desc:seed")
    expect(ui.state.filterCaret).toBe(9)
    handleKey(ui, key("escape"), data)
  })

  test("notes seed at the end, edit in the middle, save locally and clear the caret", () => {
    const db = testDb()
    try {
      db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, notes, source) VALUES (901, 'x', '2026-01-01', -1, 'local', 'cofee', 'csv')").run()
      data.setState({ transactions: loadTransactions(db) })
      const local = { ...data, updateTransactionNotes: (id: number, notes: string) => setTransactionNotes(db, id, notes) }
      ui.switchTab("manager")
      ui.setState({ detailId: 901, detailNotesCaret: 0 })
      handleKey(ui, key("n"), local)
      expect(ui.state.detailNotesCaret).toBe(5)
      handleKey(ui, key("left"), local)
      handleKey(ui, key("left"), local)
      handleKey(ui, key("f"), local)
      expect(ui.state.detailNotesDraft).toBe("coffee")
      handleKey(ui, key("return"), local)
      expect(loadTransactionDetail(db, 901)?.notes).toBe("coffee")
      expect(ui.state.detailNotesCaret).toBe(0)
      expect(ui.state.detailNotesEditing).toBe(false)
    } finally {
      ui.setState({ detailId: null, detailNotesEditing: false })
    }
  })

  test("settings text arrows move the caret; choices and toggles still change values", () => {
    ui.switchTab("settings")
    ui.openSettingsEditor("category", null, { ...ui.state.settingsDraft, name: "cofee", color: "#123456" })
    expect(ui.state.settingsCaret).toBe(5)
    handleKey(ui, key("left"), data)
    handleKey(ui, key("left"), data)
    handleKey(ui, key("f"), data)
    expect(ui.state.settingsDraft.name).toBe("coffee")
    expect(ui.state.settingsEditField).toBe(0)
    handleKey(ui, key("right"), data)
    expect(ui.state.settingsCaret).toBe(5)
    handleKey(ui, key("tab"), data)
    expect(ui.state.settingsCaret).toBe(7)
    handleKey(ui, key("down"), data)
    const before = ui.state.settingsDraft.notSpending
    handleKey(ui, key("left"), data)
    expect(ui.state.settingsDraft.notSpending).toBe(!before)
    handleKey(ui, key("right"), data)
    expect(ui.state.settingsDraft.notSpending).toBe(before)
    handleKey(ui, key("up"), data)
    expect(ui.state.settingsCaret).toBe(7)
    handleKey(ui, key("tab", { shift: true }), data)
    expect(ui.state.settingsCaret).toBe(6)
    ui.openSettingsEditor("cycle", null, { ...ui.state.settingsDraft, unit: "month", anchor: "calendar" })
    handleKey(ui, key("left"), data)
    expect(ui.state.settingsDraft.unit).toBe("fortnight")
    handleKey(ui, key("right"), data)
    expect(ui.state.settingsDraft.unit).toBe("month")
    ui.openSettingsEditor("filter", null, { ...ui.state.settingsDraft, id: "seed-id" })
    expect(ui.state.settingsCaret).toBe(7)
    handleKey(ui, key("escape"), data)
  })

  test("profile text fields reset the caret on focus; all four choice fields keep their bindings", () => {
    ui.switchTab("settings")
    ui.openProfileEditor({ ...ui.state.importProfileDraft, id: "cofee", name: "profile", accountType: "debit", hasHeader: true, descriptionJoin: false, dateFormat: "DMY" }, null)
    expect(ui.state.importProfileCaret).toBe(5)
    handleKey(ui, key("up"), data)
    handleKey(ui, key("down"), data)
    expect(ui.state.importProfileField).toBe(0)
    expect(ui.state.importProfileCaret).toBe(5)
    handleKey(ui, key("left"), data)
    handleKey(ui, key("left"), data)
    handleKey(ui, key("f"), data)
    expect(ui.state.importProfileDraft.id).toBe("coffee")
    expect(ui.state.importProfileField).toBe(0)
    handleKey(ui, key("tab"), data)
    expect(ui.state.importProfileCaret).toBe(7)
    handleKey(ui, key("tab", { shift: true }), data)
    expect(ui.state.importProfileCaret).toBe(6)
    for (const field of [3, 5, 10, 12]) {
      ui.setState({ importProfileField: field })
      const before = { ...ui.state.importProfileDraft }
      handleKey(ui, key("backspace"), data)
      handleKey(ui, key("x"), data)
      expect({ ...ui.state.importProfileDraft }).toEqual(before)
      handleKey(ui, key("left"), data)
      expect({ ...ui.state.importProfileDraft }).not.toEqual(before)
      handleKey(ui, key("right"), data)
      for (const name of ["h", "l", "space"]) {
        const before = { ...ui.state.importProfileDraft }
        handleKey(ui, key(name), data)
        expect({ ...ui.state.importProfileDraft }).not.toEqual(before)
      }
    }
    ui.cancelImport()
  })

  test("import path and reset confirmation edit at the caret and reset on open or cancel", () => {
    ui.switchTab("settings")
    ui.beginImport("/csv", [])
    handleKey(ui, key("p"), data)
    expect(ui.state.importPathCaret).toBe(0)
    for (const name of "ab.csv") handleKey(ui, key(name), data)
    handleKey(ui, key("home"), data)
    handleKey(ui, key("right"), data)
    handleKey(ui, key("x"), data)
    expect(ui.state.importPath).toBe("axb.csv")
    handleKey(ui, key("delete"), data)
    expect(ui.state.importPath).toBe("ax.csv")
    handleKey(ui, key("return"))
    expect(ui.state.importPath).toBe("/csv/ax.csv")
    expect(ui.state.importPathCaret).toBe(ui.state.importPath.length)
    ui.cancelImport()
    expect(ui.state.importPathCaret).toBe(0)
    ui.activateSettings("database")
    ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("reset") })
    handleKey(ui, key("return"), data)
    expect(ui.state.factoryResetCaret).toBe(0)
    for (const name of "REST") handleKey(ui, key(name), data)
    handleKey(ui, key("left"), data)
    handleKey(ui, key("e", { sequence: "E" }), data)
    expect(ui.state.factoryResetDraft).toBe("RESET")
    handleKey(ui, key("escape"), data)
    expect(ui.state.factoryResetCaret).toBe(0)
    expect(ui.state.factoryResetDraft).toBe("")
  })

  test("command letters and space stay literal in all six text contexts", () => {
    const contexts = [
      { open: () => ui.openFilter(), value: () => ui.state.filterDraft },
      { open: () => ui.setState({ detailId: 901, detailNotesEditing: true, detailNotesDraft: "", detailNotesCaret: 0 }), value: () => ui.state.detailNotesDraft },
      { open: () => ui.openSettingsEditor("category", null, { ...ui.state.settingsDraft, name: "" }), value: () => ui.state.settingsDraft.name },
      { open: () => { ui.beginImport("/csv", []); handleKey(ui, key("p")) }, value: () => ui.state.importPath },
      { open: () => ui.openProfileEditor({ ...ui.state.importProfileDraft, id: "" }, null), value: () => ui.state.importProfileDraft.id },
      { open: () => { ui.activateSettings("database"); ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("reset") }); handleKey(ui, key("return")) }, value: () => ui.state.factoryResetDraft },
    ]
    for (const context of contexts) {
      ui.switchTab("settings")
      ui.setState({ detailId: null, detailNotesEditing: false })
      context.open()
      for (const name of "hljknx123") handleKey(ui, key(name))
      handleKey(ui, key("space"))
      expect(context.value()).toBe("hljknx123 ")
      handleKey(ui, key("backspace"))
      expect(context.value()).toBe("hljknx123")
      handleKey(ui, key("escape"))
    }
    ui.setState({ detailId: null, detailNotesEditing: false })
    ui.switchTab("overview")
  })

})

describe("paging (every list and picker)", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => transaction({ id: i + 1, dateISO: `2026-10-${String(28 - (i % 28)).padStart(2, "0")}`, description: `Row ${i + 1}` }))
  beforeEach(() => {
    data.clearFilter()
    data.setState({ accounts: [account({ name: "A" })], transactions: rows(30), accountSelection: "all", ready: true })
    ui.switchTab("manager")
    ui.setState({ focusedSection: "mgr.transactions", txnView: "rows", managerCursor: 0, managerTop: 0, managerVisible: 10, selectedIds: {}, rangeSelecting: false, status: "" })
  })

  test("listMove pages by the list's height and jumps with home/end", async () => {
    const { listMove } = await import("./keys")
    expect(listMove(key("pagedown"), 3, 30, 10)).toBe(13)
    expect(listMove(key("pageup"), 3, 30, 10)).toBe(0)
    expect(listMove(key("pagedown"), 25, 30, 10)).toBe(29)
    expect(listMove(key("pagedown"), 0, 30)).toBe(10)
    expect(listMove(key("end"), 0, 30)).toBe(29)
    expect(listMove(key("home"), 12, 30)).toBe(0)
    expect(listMove(key("pagedown"), 0, 0)).toBe(0)
  })

  test("ctrl+d/ctrl+u page the table; ctrl+u is not undo", () => {
    handleKey(ui, key("d", { ctrl: true }), data)
    expect(ui.state.managerCursor).toBe(10)
    handleKey(ui, key("d", { ctrl: true }), data)
    handleKey(ui, key("u", { ctrl: true }), data)
    expect(ui.state.managerCursor).toBe(10)
    expect(ui.state.status).not.toMatch(/undo/i)
    handleKey(ui, key("end"), data)
    expect(ui.state.managerCursor).toBe(29)
    expect(ui.state.status).toBe("Bottom")
    handleKey(ui, key("home"), data)
    expect(ui.state.managerCursor).toBe(0)
    expect(ui.state.status).toBe("Top")
  })

  test("ctrl+n/ctrl+j/ctrl+p step; an unbound ctrl or alt letter does nothing; the scope's own ctrl keys still work", () => {
    handleKey(ui, key("n", { ctrl: true }), data)
    handleKey(ui, key("j", { ctrl: true }), data)
    expect(ui.state.managerCursor).toBe(2)
    handleKey(ui, key("p", { ctrl: true }), data)
    expect(ui.state.managerCursor).toBe(1)
    // ctrl+a and alt+a are not `a` (next account).
    handleKey(ui, key("a", { ctrl: true }), data)
    handleKey(ui, key("a", { meta: true }), data)
    expect(data.state.accountSelection).toBe("all")
    expect(ui.state.managerCursor).toBe(1)
    handleKey(ui, key("l", { ctrl: true }), data)
    expect(ui.state.filterPicker).not.toBeNull()
    ui.setState({ filterPicker: null })
  })

  test("shift+pagedown extends the range by a page", () => {
    handleKey(ui, key("pagedown", { shift: true }), data)
    expect(ui.state.managerCursor).toBe(10)
    expect(ui.state.rangeSelecting).toBe(true)
  })

  test("pickers page and jump too, letters still typing", () => {
    data.setState({ savedFilters: Array.from({ length: 25 }, (_, i) => ({ id: `f${i}`, name: `Filter ${i}`, expr: `desc:f${i}` })) })
    handleKey(ui, key("l", { ctrl: true }), data)
    handleKey(ui, key("pagedown"), data)
    expect(ui.state.filterPicker?.cursor).toBe(10)
    handleKey(ui, key("end"), data)
    expect(ui.state.filterPicker?.cursor).toBe(24)
    handleKey(ui, key("home"), data)
    expect(ui.state.filterPicker?.cursor).toBe(0)
    handleKey(ui, key("d", { ctrl: true }), data)
    expect(ui.state.filterPicker?.cursor).toBe(0)
    handleKey(ui, key("g"), data)
    expect(ui.state.filterPicker?.query).toBe("g")
    ui.setState({ filterPicker: null })
    data.setState({ savedFilters: [] })
  })
})
