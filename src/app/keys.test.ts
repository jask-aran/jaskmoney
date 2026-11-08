import { settlePending } from "../testing/keys"
import { DATABASE_ROWS } from "../state/databaseRows"
import { describe, expect, test, beforeEach } from "bun:test"
import { handleKey } from "./keys"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { loadTransactions, loadTransactionDetail, setTransactionNotes } from "../db/client"
import { account, transaction } from "../testing/fixtures"
import { key } from "../testing/keys"
import { testDb } from "../testing/scoped"

describe("key router", () => {
  beforeEach(() => {
    data.clearFilter()
    ui.switchTab("overview")
    ui.setState({ jump: null, focusedSection: "none", managerCursor: 0, managerTop: 0, selectedIds: {}, range: null })
    ui.setStatus("reset")
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
    expect((ui.state.detail?.id ?? null)).toBe(3)
    expect(ui.activeScope()).toBe("manager.detail")
    // The detail row wins over the selection for pickers.
    expect(ui.targetIds(data.scopedTransactions())).toEqual([3])
    // j browses to the next row without closing.
    handleKey(ui, key("j"), data)
    expect((ui.state.detail?.id ?? null)).toBe(2)
    // Tab keys are swallowed while the modal is open.
    handleKey(ui, key("1"), data)
    expect(ui.state.activeTab).toBe("manager")
    // n edits notes starting from the current value; printable keys are text.
    handleKey(ui, key("n"), data)
    expect(ui.activeScope()).toBe("manager.detail.notes")
    expect((ui.state.detail?.notes?.draft ?? "")).toBe("kept")
    handleKey(ui, key("j"), data)
    expect((ui.state.detail?.notes?.draft ?? "")).toBe("keptj")
    handleKey(ui, key("escape"), data)
    expect((ui.state.detail?.notes != null)).toBe(false)
    handleKey(ui, key("escape"), data)
    expect((ui.state.detail?.id ?? null)).toBeNull()
    expect(ui.targetIds(data.scopedTransactions())).toEqual([1])
    ui.setState({ selectedIds: {} })
  })

  test("settings database is rows: enter imports; clear data is enter twice, and a move disarms it", async () => {
    data.init(":memory:")
    ui.switchTab("settings")
    ui.activateSettings("database")
    ui.setState({ databaseCursor: 0 })
    handleKey(ui, key("return"), data); await settlePending()
    expect((ui.state.importWizard?.stage ?? "none")).toBe("files")
    handleKey(ui, key("escape"), data)
    ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("clearData") })
    handleKey(ui, key("return"), data)
    expect(ui.state.armed).toMatchObject({ kind: "clearData", with: "enter" })
    handleKey(ui, key("k"), data)
    expect(ui.state.armed).toBeNull()
    handleKey(ui, key("j"), data)
    handleKey(ui, key("return"), data)
    handleKey(ui, key("return"), data); await settlePending()
    expect(ui.state.armed).toBeNull()
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
    handleKey(ui, key("escape"), data)
    expect(ui.state.upAccounts).toBeNull()
    expect(ui.activeScope()).toBe("settings.up")
  })

  test("an import profile deletes on a second del; esc disarms and stays on the list", async () => {
    data.init(":memory:")
    await data.saveImportProfile({ id: "bank", name: "Bank", account: "A", accountType: "debit", importPrefix: "bank", hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" })
    ui.switchTab("settings")
    ui.activateSettings("database")
    ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("profiles") })
    handleKey(ui, key("return"), data)
    expect((ui.state.importWizard?.stage ?? "none")).toBe("profile")
    const others = data.state.importProfiles.filter((p) => p.id !== "bank").map((p) => p.id)
    ui.setState("importWizard", { profileCursor: data.state.importProfiles.findIndex((p) => p.id === "bank") })
    handleKey(ui, key("delete"), data)
    expect(ui.state.armed).toMatchObject({ kind: "profile", id: "bank" })
    handleKey(ui, key("escape"), data)
    expect(ui.state.armed).toBeNull()
    expect((ui.state.importWizard?.stage ?? "none")).toBe("profile")
    handleKey(ui, key("delete"), data)
    handleKey(ui, key("delete"), data)
    expect(ui.state.armed).toBeNull()
    expect(data.state.importProfiles.map((p) => p.id)).toEqual(others)
    expect((ui.state.importWizard?.stage ?? "none")).toBe("profile")
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
    expect((ui.state.filterBar?.caret ?? 0)).toBe(7)
    handleKey(ui, key("left"), data)
    handleKey(ui, key("2"), data)
    expect((ui.state.filterBar?.draft ?? "")).toBe("amt:-120")
    expect((ui.state.filterBar?.caret ?? 0)).toBe(7)
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
    expect((ui.state.filterBar?.caret ?? 0)).toBe(9)
    handleKey(ui, key("escape"), data)
  })

  test("notes seed at the end, edit in the middle, save locally and clear the caret", () => {
    const db = testDb()
    try {
      db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, notes, source) VALUES (901, 'x', '2026-01-01', -1, 'local', 'cofee', 'csv')").run()
      data.setState({ transactions: loadTransactions(db) })
      const local = { ...data, updateTransactionNotes: (id: number, notes: string) => { setTransactionNotes(db, id, notes); return Promise.resolve(false) } }
      ui.switchTab("manager")
      ui.setState({ detail: { id: 901, boughtTop: 0, notes: null } })
      handleKey(ui, key("n"), local)
      expect((ui.state.detail?.notes?.caret ?? 0)).toBe(5)
      handleKey(ui, key("left"), local)
      handleKey(ui, key("left"), local)
      handleKey(ui, key("f"), local)
      expect((ui.state.detail?.notes?.draft ?? "")).toBe("coffee")
      handleKey(ui, key("return"), local)
      expect(loadTransactionDetail(db, 901)?.notes).toBe("coffee")
      expect((ui.state.detail?.notes?.caret ?? 0)).toBe(0)
      expect((ui.state.detail?.notes != null)).toBe(false)
    } finally {
      ui.setState({ detail: null })
    }
  })

  test("command letters and space stay literal in all six text contexts", () => {
    const contexts = [
      { open: () => ui.openFilter(), value: () => (ui.state.filterBar?.draft ?? "") },
      { open: () => ui.setState({ detail: { boughtTop: 0, notes: { draft: "", caret: 0 }, id: 901 } }), value: () => (ui.state.detail?.notes?.draft ?? "") },
      { open: () => ui.openSettingsEditor("category", null, { ...ui.state.settingsDraft, name: "" }), value: () => ui.state.settingsDraft.name },
      { open: () => { ui.beginImport("/csv", []); handleKey(ui, key("p")) }, value: () => ui.state.importWizard!.path },
      { open: () => { ui.beginImport("", []); ui.openProfileEditor({ ...ui.state.importWizard!.profileDraft, id: "" }, null) }, value: () => ui.state.importWizard!.profileDraft.id },
      { open: () => { ui.activateSettings("database"); ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("reset") }); handleKey(ui, key("return")) }, value: () => (ui.state.factoryReset?.draft ?? "") },
    ]
    for (const context of contexts) {
      ui.switchTab("settings")
      ui.setState({ detail: null })
      context.open()
      for (const name of "hljknx123") handleKey(ui, key(name))
      handleKey(ui, key("space"))
      expect(context.value()).toBe("hljknx123 ")
      handleKey(ui, key("backspace"))
      expect(context.value()).toBe("hljknx123")
      handleKey(ui, key("escape"))
    }
    ui.setState({ detail: null })
    ui.switchTab("overview")
  })

})
