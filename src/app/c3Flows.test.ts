import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { nextSavedFilterId, nextSettingsId } from "../state/settingsConfig"
import type { ImportPreview, ImportProfile } from "../domain/types"
import { useQueries } from "../ai/catalog"
import { key } from "../testing/keys"
import { settlePending } from "../testing/settle"
import { handleKey, paletteList } from "./keys"
import { changeAccountScope, toTransactions } from "./actions"
import * as sent from "./sentPreview"

const restores: Array<() => void> = []
function keep<T extends { mockRestore(): void }>(spy: T): T {
  restores.push(() => spy.mockRestore())
  return spy
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const press = (name: string) => handleKey(ui, key(name), data)
function openPalette() { handleKey(ui, key("k", { ctrl: true }), data) }
function chooseCommand(id: string) {
  openPalette()
  const cursor = paletteList(ui, data).findIndex((command) => command.id === id)
  expect(cursor).toBeGreaterThanOrEqual(0)
  ui.setState("palette", { cursor })
  press("return")
}
const profile: ImportProfile = { id: "profile-1", name: "Bank", account: "Spending", accountType: "debit", importPrefix: "bank", hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" }
const preview: ImportPreview = { path: "/csv/bank.csv", filename: "bank.csv", profile, accountId: 100, accountName: "Spending", rows: [], errors: [], newCount: 0, duplicateCount: 0, rulesEnabled: true }

beforeEach(() => {
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv'), (200, 'Other', 'debit', 'csv')").run()
  for (let id = 1; id <= 4; id++) db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (?, 'x', '2026-10-01', -5, ?, ?, 'csv')").run(id, `Shop ${id}`, id <= 2 ? 100 : 200)
  data.refresh()
  data.setAccountSelection("all")
  ui.switchTab("manager")
})
afterEach(async () => {
  await settlePending()
  for (const restore of restores.splice(0)) restore()
  ui.reset()
})

test("C3.1 settings IDs fill gaps, ignore case, and both creation keys use them", () => {
  const filters = [{ id: "FILTER-1", name: "One", expr: "desc:one" }, { id: "filter-3", name: "Three", expr: "desc:three" }]
  expect(nextSavedFilterId(filters)).toBe("filter-2")
  expect(nextSettingsId("PROFILE", [{ id: "profile-1" }, { id: "PROFILE-3" }])).toBe("PROFILE-2")
  expect(nextSettingsId("filter", [])).toBe("filter-1")
  data.setState({ savedFilters: filters, importProfiles: [profile, { ...profile, id: "profile-3" }] })
  ui.switchTab("settings")
  ui.activateSettings("filters")
  press("a")
  expect(ui.state.settingsDraft.id).toBe("filter-2")
  press("escape")
  ui.beginImport("/csv", [])
  ui.setState("importWizard", { stage: "profile" })
  press("a")
  expect(ui.state.importWizard?.profileDraft.id).toBe("profile-2")
})

test("C3.2 Transactions always means rows", () => {
  ui.setState({ txnView: "merchants", focusedSection: "mgr.accounts" })
  toTransactions(ui)
  expect(ui.activeScope()).toBe("manager.txns")
})

for (const command of ["txn:tag-review", "rules:offers", "txn:uncategorised"]) {
  test(`C3.2 ${command} opens the row scope from merchants`, () => {
    ui.setState({ txnView: "merchants" })
    keep(spyOn(data, "suggestCategories")).mockResolvedValue(0)
    keep(spyOn(data, "allRuleOffers")).mockReturnValue([{ source: "repeat", description: "Shop", expr: "desc:shop", categoryId: 1, tagId: null, times: 3, categorised: 3, agreeing: 3, waiting: [], others: [] }])
    chooseCommand(command)
    expect(ui.state.txnView).toBe("rows")
    if (command === "txn:tag-review") {
      expect(ui.state.tagChooser).not.toBeNull()
      expect(ui.state.tagPicker).toBeNull()
    } else if (command === "rules:offers") expect(ui.activeScope()).toBe("manager.ruleOffers")
    else {
      expect(ui.activeScope()).toBe("manager.txns")
      expect(data.state.uncategorisedOnly).toBe(true)
    }
  })
}

test("C3.2 Overview review and drill-down return to rows after merchants", () => {
  keep(spyOn(data, "suggestCategories")).mockResolvedValue(0)
  for (const action of ["i", "o", "/", "?"]) {
    data.setState({ uncategorisedOnly: false })
    ui.switchTab("overview")
    ui.setState({ txnView: "merchants", focusedSection: "none" })
    press(action)
    expect(ui.state.txnView).toBe("rows")
    expect(ui.state.focusedSection).toBe("mgr.transactions")
    expect(ui.state.activeTab).toBe("manager")
  }
})

test("C3.3 Budgets commands focus the Budgets pane and c opens the cycle editor", () => {
  ui.switchTab("budgets")
  ui.setState({ focusedSection: "bud.chart", budgetCategoryCursor: 2 })
  chooseCommand("settings:cycle")
  expect(ui.state.focusedSection).toBe("bud.categories")
  expect(ui.state.budgetCategoryCursor).toBe(2)
  expect(ui.state.settingsEditor?.kind).toBe("cycle")
  press("escape")
  ui.setState({ focusedSection: "bud.chart" })
  chooseCommand("add:budget")
  expect(ui.state.focusedSection).toBe("bud.categories")
  expect(ui.state.settingsEditor?.kind).toBe("budget")
})

test("C3.3 a palette key refuses a scope that changed while it was open", () => {
  openPalette()
  const cursor = paletteList(ui, data).findIndex((c) => c.id === "key:manager.txns:c")
  expect(cursor).toBeGreaterThanOrEqual(0)
  ui.setState("palette", { cursor })
  // Simulate an incoming UI change while the palette owns input.
  ui.setState({ txnView: "merchants" })
  press("return")
  expect(ui.state.palette).toBeNull()
  expect(ui.state.catPicker).toBeNull()
  expect(ui.state.statusErr).toBe(true)
})

function seedTargets() {
  ui.setState({ managerCursor: 1, managerTop: 1, merchantCursor: 3, merchantTop: 2, selectedIds: { 1: true }, range: { anchorId: 1, cursorId: 2 } })
}
test("C3.4 account scope reset matrix keeps Overview and accounts-pane merchant positions", () => {
  for (const origin of ["accounts", "rows", "merchants", "overview"] as const) {
    seedTargets()
    changeAccountScope(ui, data, 200, origin)
    expect(data.state.accountSelection).toBe(200)
    expect(ui.state.managerCursor).toBe(origin === "overview" ? 1 : 0)
    expect(ui.state.managerTop).toBe(origin === "overview" ? 1 : 0)
    expect(ui.state.selectedIds).toEqual(origin === "overview" ? { 1: true } : {})
    expect(ui.state.range).toEqual(origin === "overview" ? { anchorId: 1, cursorId: 2 } : null)
    expect(ui.state.merchantCursor).toBe(origin === "rows" || origin === "merchants" ? 0 : 3)
    expect(ui.state.merchantTop).toBe(origin === "rows" || origin === "merchants" ? 0 : 2)
  }
})

test("C3.4 all five account paths use the shared reset rules", () => {
  for (const path of ["accounts", "rows", "merchants", "palette", "overview"] as const) {
    data.setAccountSelection("all")
    ui.switchTab(path === "overview" ? "overview" : "manager")
    ui.setState({ txnView: path === "merchants" ? "merchants" : "rows", focusedSection: path === "accounts" ? "mgr.accounts" : path === "overview" ? "none" : "mgr.transactions" })
    seedTargets()
    if (path === "palette") chooseCommand("txn:account:200")
    else press(path === "accounts" ? "j" : "a")
    expect(data.state.accountSelection).not.toBe("all")
    expect(ui.state.selectedIds).toEqual(path === "overview" ? { 1: true } : {})
    expect(ui.state.range).toEqual(path === "overview" ? { anchorId: 1, cursorId: 2 } : null)
    expect(ui.state.merchantTop).toBe(path === "accounts" || path === "overview" ? 2 : 0)
  }
})

test("C3.4 merchant a keeps its cursor reset when no account rows exist", () => {
  data.setState({ accounts: [] })
  ui.setState({ txnView: "merchants", merchantCursor: 3, merchantTop: 2 })
  press("a")
  expect(ui.state.merchantCursor).toBe(0)
  expect(ui.state.merchantTop).toBe(2)
})

test("C3.5 picker and palette each commit, record usage, and run an ask once", async () => {
  const filter = { id: "question", name: "Question", expr: 'ask:"coffee"' }
  data.setState({ savedFilters: [filter] })
  const commit = keep(spyOn(data, "commitFilter"))
  const usage = keep(spyOn(data, "recordFilterUsage")).mockResolvedValue(undefined)
  const ask = keep(spyOn(data, "askAbout")).mockResolvedValue(null)
  for (const path of ["picker", "palette"]) {
    data.clearFilter()
    seedTargets()
    if (path === "picker") { ui.setState({ filterPicker: { query: "", cursor: 0 } }); press("return") }
    else chooseCommand("txn:saved:question")
    await settlePending()
    expect(commit).toHaveBeenCalledTimes(path === "picker" ? 1 : 2)
    expect(usage).toHaveBeenCalledTimes(path === "picker" ? 1 : 2)
    expect(ask).toHaveBeenCalledTimes(path === "picker" ? 1 : 2)
    expect(ui.state.managerCursor).toBe(0)
    expect(ui.state.merchantTop).toBe(0)
    expect(ui.state.filterPicker).toBeNull()
  }
})

test("C3.6 account completion cannot close a later account dialog", async () => {
  const answer = deferred<number>()
  keep(spyOn(data, "clearAccountData")).mockReturnValue(answer.promise)
  ui.setState({ accountAction: { id: 100, cursor: 0 } })
  press("return"); press("return"); press("escape")
  ui.setState({ accountAction: { id: 200, cursor: 0 } })
  answer.resolve(0)
  await settlePending()
  expect(ui.state.accountAction?.id).toBe(200)
})

test("C3.6 query replies belong to an opening even when its query is reopened", async () => {
  const first = deferred<sent.SentPart[]>(), second = deferred<sent.SentPart[]>()
  keep(spyOn(sent, "previewSent")).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  ui.switchTab("settings")
  ui.setState({ aiUse: { use: "suggestions", cursor: 0, note: null } })
  press("return")
  const query = useQueries("suggestions")[0]!
  expect(ui.state.aiSent?.query).toBe(query)
  press("escape"); press("return")
  first.resolve([{ query, to: "old", body: {}, sample: "old" }])
  await settlePending()
  expect(ui.state.aiSent?.part).toBeNull()
  second.resolve([{ query, to: "new", body: {}, sample: "new" }])
  await settlePending()
  expect(ui.state.aiSent?.part?.to).toBe("new")
})

for (const action of ["key", "accountId", "model"] as const) {
  test(`C3.6 ${action} saves block duplicate enter and another field until settled`, async () => {
    const answer = deferred<void>()
    const save = keep(spyOn(data, "saveApiKeys")).mockReturnValue(answer.promise)
    ui.switchTab("settings")
    // (A key on Jev: Clairic's would go on to find its account, which a faked save can't.)
    ui.setState({ aiDialog: { row: action === "model" ? "openrouter" : action === "key" ? "jev" : "workersAi", cursor: 0, field: { action, value: action === "model" ? "" : "test-value", caret: 0 }, note: null, busy: false } })
    press("return"); press("return")
    expect(save).toHaveBeenCalledTimes(1)
    expect(ui.state.aiDialog?.busy).toBe(true)
    press("escape"); press("return")
    expect(ui.state.aiDialog?.field).toBeNull()
    answer.resolve()
    await settlePending()
    expect(ui.state.aiDialog?.busy).toBe(false)
    expect(ui.state.aiDialog?.note?.ok).toBe(true)
  })
}

for (const stage of ["files", "path", "profile"] as const) {
  test(`C3.6 a late ${stage} import preview cannot change a later stage`, async () => {
    const answer = deferred<ImportPreview>()
    keep(spyOn(data, "previewImport")).mockReturnValue(answer.promise)
    keep(spyOn(data, "profileMatches")).mockReturnValue([profile])
    data.setState({ importProfiles: [profile] })
    ui.switchTab("settings")
    ui.beginImport("/csv", [preview.path])
    ui.setState("importWizard", { stage, path: preview.path })
    press("return")
    press(stage === "files" ? "p" : "escape")
    const after = ui.state.importWizard?.stage
    answer.resolve(preview)
    await settlePending()
    expect(ui.state.importWizard?.stage).toBe(after)
    expect(ui.state.importWizard?.preview).toBeNull()
  })
}

for (const pending of ["save", "preview"] as const) {
  test(`C3.6 a profile ${pending} reply cannot leave the stage returned to with esc`, async () => {
    const saved = deferred<void>(), scanned = deferred<ImportPreview>()
    keep(spyOn(data, "saveImportProfile")).mockReturnValue(saved.promise)
    const scan = keep(spyOn(data, "previewImport")).mockReturnValue(scanned.promise)
    ui.switchTab("settings")
    ui.beginImport("/csv", [])
    ui.setState("importWizard", { path: preview.path })
    ui.openProfileEditor(profile, null)
    press("return")
    if (pending === "preview") { saved.resolve(); await settlePending(); expect(scan).toHaveBeenCalledTimes(1) }
    press("escape")
    saved.resolve(); scanned.resolve(preview)
    await settlePending()
    expect(ui.state.importWizard?.stage).toBe("profile")
    expect(ui.state.importWizard?.preview).toBeNull()
    if (pending === "save") expect(scan).not.toHaveBeenCalled()
  })
}

for (const outcome of ["resolve", "reject"] as const) {
  test(`C3.7 confirmation runs once while pending and rearms after ${outcome}`, async () => {
    const answer = deferred<number>()
    const clear = keep(spyOn(data, "clearAccountData")).mockReturnValue(answer.promise)
    ui.setState({ accountAction: { id: 100, cursor: 0 } })
    press("return"); press("j")
    expect(ui.state.armed).toBeNull()
    press("k"); press("return"); press("return"); press("return"); press("return")
    expect(clear).toHaveBeenCalledTimes(1)
    expect(ui.state.armed).toBeNull()
    if (outcome === "resolve") answer.resolve(0)
    else answer.reject(new Error("write refused"))
    await settlePending()
    if (outcome === "reject") expect(ui.state.status).toBe("write refused")
    ui.setState({ accountAction: { id: 100, cursor: 0 } })
    press("return")
    expect(ui.state.armed?.kind).toBe("clearAccount")
    expect(clear).toHaveBeenCalledTimes(1)
  })
}

test("C3.7 a pending account confirmation does not block another action's K2 keys", async () => {
  const answer = deferred<number>()
  keep(spyOn(data, "clearAccountData")).mockReturnValue(answer.promise)
  const remove = keep(spyOn(data, "deleteSavedFilter")).mockResolvedValue(undefined)
  ui.setState({ accountAction: { id: 100, cursor: 0 } })
  press("return"); press("return")
  try {
    press("escape")
    ui.switchTab("settings")
    ui.activateSettings("filters")
    data.setState({ savedFilters: [{ id: "coffee", name: "Coffee", expr: "desc:coffee" }] })
    press("delete")
    expect(ui.state.armed?.kind).toBe("filter")
    press("delete")
    expect(remove).toHaveBeenCalledTimes(1)
  } finally {
    answer.resolve(0)
    await settlePending()
  }
})
