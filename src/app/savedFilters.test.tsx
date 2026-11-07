import { settlePending } from "../testing/settle"
import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { handleKey, footerHints } from "./keys"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { loadSettingsConfig } from "../state/settingsConfig"
import { ensureAccount } from "../db/client"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"

beforeEach(() => {
  testEnv("JASKMONEY_CONFIG", join(mkdtempSync(join(tmpdir(), "jaskmoney-filter-job-")), "settings.json"))
  data.init(":memory:")
  data.clearFilter()
  ui.switchTab("manager")
  ui.setState({ detail: null, txnView: "rows" })
})
afterEach(() => {
  ui.switchTab("overview")
})

test("ctrl+s pre-fills a new filter on Name in both transaction views; empty filter stays closed", async () => {
  await data.saveSavedFilter({ id: "filter-1", name: "Existing", expr: "desc:Other" })
  for (const txnView of ["rows", "merchants"] as const) {
    ui.setState({ txnView })
    data.clearFilter()
    handleKey(ui, key("s", { ctrl: true }), data)
    expect(ui.state.settingsEditor).toBeNull()
    expect(ui.state.status).toBe("No filter to save")
    data.commitFilter("desc:Coffee")
    handleKey(ui, key("s", { ctrl: true }), data)
    expect(ui.state.settingsDraft).toMatchObject({ id: "filter-2", name: "", expr: "desc:Coffee" })
    expect(ui.state.settingsEditor!.field).toBe(1)
    expect(ui.activeScope()).toBe("settings.editor")
    handleKey(ui, key("j"), data)
    expect(ui.state.settingsDraft.name).toBe("j")
    handleKey(ui, key("escape"), data)
    expect(data.state.savedFilters).toHaveLength(1)
    handleKey(ui, key("s", { ctrl: true }), data)
    handleKey(ui, key("N"), data)
    handleKey(ui, key("enter"), data); await settlePending()
    expect(ui.state.settingsEditor).toBeNull()
    expect(data.state.savedFilters.some((filter) => filter.name === "N")).toBe(true)
    await data.deleteSavedFilter("filter-2")
  }
})

test("ctrl+l applies a saved filter, resets cursors, and persists usage; printable letters filter", async () => {
  await data.saveSavedFilter({ id: "coffee", name: "Java", expr: "desc:Coffee" })
  await data.saveSavedFilter({ id: "other", name: "Other", expr: "desc:Other" })
  for (const txnView of ["rows", "merchants"] as const) {
    ui.setState({ txnView, managerCursor: 8, managerTop: 5, merchantCursor: 4, merchantTop: 2 })
    handleKey(ui, key("l", { ctrl: true }), data)
    expect(ui.activeScope()).toBe("filterPicker")
    handleKey(ui, key("v"), data)
    expect(ui.state.filterPicker?.query).toBe("v")
    handleKey(ui, key("enter"), data); await settlePending()
    expect(ui.state.filterPicker).toBeNull()
    expect(data.state.filterQuery).toBe("desc:Coffee")
    expect(ui.state.managerCursor).toBe(0)
    expect(ui.state.merchantCursor).toBe(0)
    expect(ui.state.status).toBe("Filter: Java")
    expect(Number.isFinite(Date.parse(data.state.uiPrefs.filterUsage?.coffee ?? ""))).toBe(true)
    expect(loadSettingsConfig().ui?.filterUsage?.coffee).toBe(data.state.uiPrefs.filterUsage?.coffee)
  }
  handleKey(ui, key("l", { ctrl: true }), data)
  handleKey(ui, key("escape"), data)
  expect(ui.state.filterPicker).toBeNull()
  expect(data.state.filterQuery).toBe("desc:Coffee")
  await data.deleteSavedFilter("coffee")
  expect(data.state.uiPrefs.filterUsage?.coffee).toBeUndefined()
  expect(loadSettingsConfig().ui?.filterUsage?.coffee).toBeUndefined()
  expect(footerHints("filterPicker").some((hint) => hint.key === "type")).toBe(true)
})

test("filter usage loads valid timestamps, ignores malformed values, and drops deleted IDs on save", async () => {
  writeFileSync(process.env.JASKMONEY_CONFIG!, JSON.stringify({ version: 2, savedFilters: [{ id: "a", name: "A", expr: "desc:a" }], ui: { filterUsage: { a: "2026-01-01T00:00:00Z", gone: "2026-01-02T00:00:00Z", bad: 3, wrong: "nope" }, weekStart: "sunday" } }))
  data.init(":memory:")
  expect(data.state.uiPrefs.filterUsage).toEqual({ a: "2026-01-01T00:00:00Z", gone: "2026-01-02T00:00:00Z" })
  await data.saveUiPrefs({ chartViews: [1, 2] })
  expect(loadSettingsConfig().ui).toMatchObject({ filterUsage: { a: "2026-01-01T00:00:00Z" }, weekStart: "sunday" })
})

test("Shift+D opens a report without writes; Shift+A writes the same category and tag results", async () => {
  const db = data.getDb()!
  const account = ensureAccount(db, "Local", "debit")
  db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, account_id) VALUES ('x', '2026-01-01', -5, 'Coffee', ?)").run(account.id)
  data.refresh()
  const category = await data.createSettingsCategory({ name: "Coffee category", color: "#ffffff" })
  const tag = await data.createSettingsTag({ name: "Local tag", color: "#ffffff", categoryIds: [], about: null })
  await data.saveSavedFilter({ id: "coffee", name: "Coffee", expr: "desc:Coffee" })
  await data.saveSavedFilter({ id: "later", name: "Later", expr: 'cat:"Coffee category"' })
  await data.createSettingsRule({ name: "First", savedFilterId: "coffee", setCategoryId: category, addTagIds: [], enabled: true })
  await data.createSettingsRule({ name: "Later", savedFilterId: "later", setCategoryId: null, addTagIds: [tag], enabled: true })
  ui.switchTab("settings")
  ui.activateSettings("rules")
  handleKey(ui, key("d", { shift: true }), data)
  expect(ui.activeScope()).toBe("dryRun")
  expect(ui.state.dryRun?.report).toMatchObject({ transactionCount: 1, updatedTransactions: 1, categoryChanges: 1, tagChanges: 1 })
  expect(data.state.transactions[0]?.categoryId).not.toBe(category)
  expect(db.query("SELECT category_source FROM transactions").get()).toEqual({ category_source: null })
  handleKey(ui, key("2"), data)
  expect(ui.state.activeTab).toBe("settings")
  handleKey(ui, key("escape"), data)
  handleKey(ui, key("a", { shift: true }), data); await settlePending()
  expect(data.state.transactions[0]?.categoryId).toBe(category)
  expect([...data.state.transactions[0]!.tagIds]).toEqual([tag])
  expect(db.query("SELECT category_source FROM transactions").get()).toEqual({ category_source: "rule" })
  handleKey(ui, key("d", { shift: true }), data)
  expect(ui.state.dryRun?.report?.updatedTransactions).toBe(0)
  ui.switchTab("manager")
  expect(ui.state.dryRun?.report ?? null).toBeNull()
})

test("saved-filter input keeps command letters and space literal; arrows move and backspace edits", async () => {
  await data.saveSavedFilter({ id: "a", name: "Alpha", expr: "desc:a" })
  await data.saveSavedFilter({ id: "b", name: "Beta", expr: "desc:b" })
  handleKey(ui, key("l", { ctrl: true }), data)
  handleKey(ui, key("down"), data)
  expect(ui.state.filterPicker?.cursor).toBe(1)
  handleKey(ui, key("up"), data)
  expect(ui.state.filterPicker?.cursor).toBe(0)
  handleKey(ui, key("n", { ctrl: true }), data)
  expect(ui.state.filterPicker?.cursor).toBe(1)
  handleKey(ui, key("p", { ctrl: true }), data)
  expect(ui.state.filterPicker?.cursor).toBe(0)
  // Every printable key types, j and k included (a search takes any letter).
  for (const name of ["h", "l", "j", "k", "g", "2"]) handleKey(ui, key(name), data)
  handleKey(ui, key("space"), data)
  expect(ui.state.filterPicker?.query).toBe("hljkg2 ")
  expect(ui.state.activeTab).toBe("manager")
  handleKey(ui, key("backspace"), data)
  expect(ui.state.filterPicker?.query).toBe("hljkg2")
  handleKey(ui, key("enter"), data)
  expect(ui.state.filterPicker).not.toBeNull()
  handleKey(ui, key("escape"), data)
  expect(ui.activeScope()).toBe("manager.txns")
  expect(data.state.filterQuery).toBe("")
})
