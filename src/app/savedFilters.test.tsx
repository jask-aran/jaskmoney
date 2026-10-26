import { afterEach, beforeEach, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { TextAttributes } from "@opentui/core"
import { handleKey, footerHints } from "./keys"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { loadSettingsConfig } from "../state/settingsConfig"
import { ensureAccount } from "../db/client"
import { renderApp } from "../testing/app"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"

let rendered: Awaited<ReturnType<typeof renderApp>> | undefined

beforeEach(() => {
  testEnv("JASKMONEY_CONFIG", join(mkdtempSync(join(tmpdir(), "jaskmoney-filter-job-")), "settings.json"))
  data.init(":memory:")
  data.clearFilter()
  ui.switchTab("manager")
  ui.setState({ detailId: null, formPicker: null, txnView: "rows" })
})
afterEach(() => {
  // Unmount before switching tabs, so the switch runs no App effects.
  rendered?.renderer.destroy()
  rendered = undefined
  ui.switchTab("overview")
})

test("ctrl+s pre-fills a new filter on Name in both transaction views; empty filter stays closed", () => {
  data.saveSavedFilter({ id: "filter-1", name: "Existing", expr: "desc:Other" })
  for (const txnView of ["rows", "merchants"] as const) {
    ui.setState({ txnView })
    data.clearFilter()
    handleKey(ui, key("s", { ctrl: true }), data)
    expect(ui.state.settingsEditor).toBeNull()
    expect(ui.state.status).toBe("No filter to save")
    data.commitFilter("desc:Coffee")
    handleKey(ui, key("s", { ctrl: true }), data)
    expect(ui.state.settingsDraft).toMatchObject({ id: "filter-2", name: "", expr: "desc:Coffee" })
    expect(ui.state.settingsEditField).toBe(1)
    expect(ui.activeScope()).toBe("settings.editor")
    handleKey(ui, key("j"), data)
    expect(ui.state.settingsDraft.name).toBe("j")
    handleKey(ui, key("escape"), data)
    expect(data.state.savedFilters).toHaveLength(1)
    handleKey(ui, key("s", { ctrl: true }), data)
    handleKey(ui, key("N"), data)
    handleKey(ui, key("enter"), data)
    expect(ui.state.settingsEditor).toBeNull()
    expect(data.state.savedFilters.some((filter) => filter.name === "N")).toBe(true)
    data.deleteSavedFilter("filter-2")
  }
})

test("ctrl+l applies a saved filter, resets cursors, and persists usage; printable letters filter", () => {
  data.saveSavedFilter({ id: "coffee", name: "Java", expr: "desc:Coffee" })
  data.saveSavedFilter({ id: "other", name: "Other", expr: "desc:Other" })
  for (const txnView of ["rows", "merchants"] as const) {
    ui.setState({ txnView, managerCursor: 8, managerTop: 5, merchantCursor: 4, merchantTop: 2 })
    handleKey(ui, key("l", { ctrl: true }), data)
    expect(ui.activeScope()).toBe("filterPicker")
    handleKey(ui, key("v"), data)
    expect(ui.state.filterPicker?.query).toBe("v")
    handleKey(ui, key("enter"), data)
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
  data.deleteSavedFilter("coffee")
  expect(data.state.uiPrefs.filterUsage?.coffee).toBeUndefined()
  expect(loadSettingsConfig().ui?.filterUsage?.coffee).toBeUndefined()
  expect(footerHints("filterPicker").some((hint) => hint.key === "type")).toBe(true)
})

test("filter usage loads valid timestamps, ignores malformed values, and drops deleted IDs on save", () => {
  writeFileSync(process.env.JASKMONEY_CONFIG!, JSON.stringify({ version: 2, savedFilters: [{ id: "a", name: "A", expr: "desc:a" }], ui: { filterUsage: { a: "2026-01-01T00:00:00Z", gone: "2026-01-02T00:00:00Z", bad: 3, wrong: "nope" }, weekStart: "sunday" } }))
  data.init(":memory:")
  expect(data.state.uiPrefs.filterUsage).toEqual({ a: "2026-01-01T00:00:00Z", gone: "2026-01-02T00:00:00Z" })
  data.saveUiPrefs({ chartViews: [1, 2] })
  expect(loadSettingsConfig().ui).toMatchObject({ filterUsage: { a: "2026-01-01T00:00:00Z" }, weekStart: "sunday" })
})

test("Shift+D opens a report without writes; Shift+A writes the same category and tag results", () => {
  const db = data.getDb()!
  const account = ensureAccount(db, "Local", "debit")
  db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, account_id) VALUES ('x', '2026-01-01', -5, 'Coffee', ?)").run(account.id)
  data.refresh()
  const category = data.createSettingsCategory({ name: "Coffee category", color: "#ffffff" })
  const tag = data.createSettingsTag({ name: "Local tag", color: "#ffffff", categoryId: null })
  data.saveSavedFilter({ id: "coffee", name: "Coffee", expr: "desc:Coffee" })
  data.saveSavedFilter({ id: "later", name: "Later", expr: 'cat:"Coffee category"' })
  data.createSettingsRule({ name: "First", savedFilterId: "coffee", setCategoryId: category, addTagIds: [], enabled: true })
  data.createSettingsRule({ name: "Later", savedFilterId: "later", setCategoryId: null, addTagIds: [tag], enabled: true })
  ui.switchTab("settings")
  ui.activateSettings("rules")
  handleKey(ui, key("d", { shift: true }), data)
  expect(ui.activeScope()).toBe("dryRun")
  expect(ui.state.dryRunReport).toMatchObject({ transactionCount: 1, updatedTransactions: 1, categoryChanges: 1, tagChanges: 1 })
  expect(data.state.transactions[0]?.categoryId).not.toBe(category)
  expect(db.query("SELECT category_source FROM transactions").get()).toEqual({ category_source: null })
  handleKey(ui, key("2"), data)
  expect(ui.state.activeTab).toBe("settings")
  handleKey(ui, key("escape"), data)
  handleKey(ui, key("a", { shift: true }), data)
  expect(data.state.transactions[0]?.categoryId).toBe(category)
  expect([...data.state.transactions[0]!.tagIds]).toEqual([tag])
  expect(db.query("SELECT category_source FROM transactions").get()).toEqual({ category_source: "rule" })
  handleKey(ui, key("d", { shift: true }), data)
  expect(ui.state.dryRunReport?.updatedTransactions).toBe(0)
  ui.switchTab("manager")
  expect(ui.state.dryRunReport).toBeNull()
})

test("App shows the filter editor on Transactions, updates status colours, and retains the Name cursor", async () => {
  rendered = await renderApp({ width: 140, height: 42 })
  ui.switchTab("manager")
  data.getDb()!.query("INSERT INTO transactions (date_raw, date_iso, amount, description) VALUES ('x', '2026-01-01', -5, 'Coffee')").run()
  data.refresh()
  const transaction = { ...data.state.transactions[0]! }
  let reads = 0
  Object.defineProperty(transaction, "description", { enumerable: true, get() { reads++; return "Coffee" } })
  data.setState({ transactions: [transaction] })
  data.commitFilter("desc:Coffee")
  handleKey(ui, key("s", { ctrl: true }), data)
  const draw = async () => { await rendered!.renderOnce(); await rendered!.flush() }
  await draw()
  expect(rendered.captureCharFrame()).toContain("New saved filter")
  expect(rendered.captureCharFrame()).toContain("desc:Coffee")
  const status = (needle: string) => rendered!.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes(needle))!
  expect(status("ok · 1 txns").fg.toInts()).toEqual([166, 227, 161, 255])
  const name = status("Name")
  expect(name.attributes & TextAttributes.BOLD).toBe(TextAttributes.BOLD)
  const previousReads = reads
  handleKey(ui, key("N"), data)
  await draw()
  expect(reads).toBe(previousReads)
  ui.setState("settingsDraft", "expr", "(")
  await draw()
  expect(status("invalid:").fg.toInts()).toEqual([243, 139, 168, 255])
  ui.setState("settingsDraft", "expr", "")
  await draw()
  expect(status("● empty").fg.toInts()).toEqual([127, 132, 156, 255])
  handleKey(ui, key("escape"), data)
  expect(ui.activeScope()).toBe("manager.txns")
})

test("rule health and selection colours use captured cells; dry-run body scrolls and owns input", async () => {
  rendered = await renderApp({ width: 160, height: 32 })
  ui.switchTab("settings")
  ui.activateSettings("rules")
  data.setState({
    savedFilters: [{ id: "ok", name: "Valid", expr: "desc:Coffee" }, { id: "bad", name: "Bad", expr: "(" }],
    rules: [
      { id: 1, name: "Healthy", savedFilterId: "ok", setCategoryId: null, addTagIds: [], sortOrder: 0, enabled: true },
      { id: 2, name: "Broken", savedFilterId: "gone", setCategoryId: null, addTagIds: [], sortOrder: 1, enabled: true },
      { id: 3, name: "Invalid", savedFilterId: "bad", setCategoryId: null, addTagIds: [], sortOrder: 2, enabled: true },
      { id: 4, name: "Disabled", savedFilterId: "absent", setCategoryId: null, addTagIds: [], sortOrder: 3, enabled: false },
    ],
  })
  ui.setState({ ruleCursor: 0 })
  const draw = async () => { await rendered!.renderOnce(); await rendered!.flush() }
  const span = (needle: string) => rendered!.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes(needle))!
  await draw()
  expect(span("1. Healthy").bg.toInts()).toEqual([49, 50, 68, 255])
  expect(span("filter:gone").fg.toInts()).toEqual([243, 139, 168, 255])
  expect(span("filter:bad").fg.toInts()).toEqual([243, 139, 168, 255])
  expect(span("4. Disabled").fg.toInts()).toEqual([127, 132, 156, 255])
  expect(span("filter:absent").fg.toInts()).toEqual([127, 132, 156, 255])
  ui.setState({ ruleCursor: 1 })
  await draw()
  expect(span("1. Healthy").bg.toInts()).toEqual([17, 17, 27, 255])
  expect(span("filter:gone").bg.toInts()).toEqual([49, 50, 68, 255])

  const report = data.dryRunRules()
  ui.setState({ dryRunReport: { ...report, rules: Array.from({ length: 12 }, (_, index) => ({ ...report.rules[0]!, rule: { ...report.rules[0]!.rule, name: `Scroll rule ${index + 1}` } })) }, dryRunScroll: 0 })
  await draw()
  expect(rendered.captureCharFrame()).toContain("All 0 transactions")
  expect(rendered.captureCharFrame()).toContain("0 transactions would change")
  expect(rendered.captureCharFrame()).toContain("1. Scroll rule 1")
  handleKey(ui, key("3"), data)
  expect(ui.activeScope()).toBe("dryRun")
  for (let i = 0; i < 60; i++) handleKey(ui, key("j"), data)
  await draw()
  expect(rendered.captureCharFrame()).toContain("12. Scroll rule 12")
  const bottom = ui.state.dryRunScroll
  handleKey(ui, key("k"), data)
  expect(ui.state.dryRunScroll).toBe(bottom - 1)
  handleKey(ui, key("escape"), data)
  expect(ui.activeScope()).toBe("settings.rules")
})

test("saved-filter rows show muted expressions and picker reset on tab switch", async () => {
  rendered = await renderApp({ width: 140, height: 28 })
  data.setState({ savedFilters: [{ id: "coffee", name: "Java", expr: "desc:Coffee" }] })
  ui.switchTab("manager")
  handleKey(ui, key("l", { ctrl: true }), data)
  await rendered.renderOnce()
  await rendered.flush()
  const expression = rendered.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes("desc:Coffee"))!
  expect(expression.fg.toInts()).toEqual([127, 132, 156, 255])
  expect(rendered.captureCharFrame()).toContain("Saved filters")
  ui.switchTab("settings")
  expect(ui.state.filterPicker).toBeNull()
})

test("dry-run samples keep amount and actions visible after a long description", async () => {
  rendered = await renderApp({ width: 140, height: 28 })
  const db = data.getDb()!
  db.query("INSERT INTO transactions (date_raw, date_iso, amount, description) VALUES ('x', '2026-01-01', -5, ?)").run("Coffee ".repeat(30))
  data.refresh()
  const category = data.createSettingsCategory({ name: "Food", color: "#ffffff" })
  const tag = data.createSettingsTag({ name: "Weekly", color: "#ffffff", categoryId: null })
  data.saveSavedFilter({ id: "coffee", name: "Coffee", expr: "desc:Coffee" })
  data.createSettingsRule({ name: "Coffee rule", savedFilterId: "coffee", setCategoryId: category, addTagIds: [tag], enabled: true })
  ui.switchTab("settings")
  ui.activateSettings("rules")
  handleKey(ui, key("d", { shift: true }), data)
  await rendered.renderOnce()
  await rendered.flush()
  const frame = rendered.captureCharFrame()
  expect(frame).toContain("2026-01-01")
  expect(frame).toContain("-$5.00 → Food +WEEKLY")
  expect(frame).toContain("matched 1 · category 1 · tags 1")
})

test("saved-filter input keeps command letters and space literal; arrows move and backspace edits", () => {
  data.saveSavedFilter({ id: "a", name: "Alpha", expr: "desc:a" })
  data.saveSavedFilter({ id: "b", name: "Beta", expr: "desc:b" })
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
