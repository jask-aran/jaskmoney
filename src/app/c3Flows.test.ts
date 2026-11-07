import { afterEach, beforeEach, expect, spyOn, test } from "bun:test"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { nextSavedFilterId, nextSettingsId } from "../state/settingsConfig"
import type { ImportProfile } from "../domain/types"
import { key } from "../testing/keys"
import { settlePending } from "../testing/settle"
import { handleKey } from "./keys"

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
const profile: ImportProfile = { id: "profile-1", name: "Bank", account: "Spending", accountType: "debit", importPrefix: "bank", hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" }

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
