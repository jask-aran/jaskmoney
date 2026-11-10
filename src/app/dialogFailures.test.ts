import { expect, onTestFinished, spyOn, test } from "bun:test"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { buildImportPreview } from "../db/profileImport"
import { DEFAULT_IMPORT_PROFILES } from "../state/settingsConfig"
import type { RuleOffer } from "../domain/ruleOffers"
import { key } from "../testing/keys"
import { settlePending } from "../testing/keys"
import { handleKey } from "./keys"

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

const press = (name: string) => handleKey(ui, key(name), data)

test("a failed settings save releases saving and permits a retry", async () => {
  data.init(":memory:")
  const save = spyOn(data, "createSettingsCategory").mockRejectedValueOnce(new Error("save failed")).mockResolvedValue(1)
  onTestFinished(() => save.mockRestore())
  ui.openSettingsEditor("category", null, { ...ui.state.settingsDraft, name: "Coffee" })
  press("return")
  expect(ui.state.settingsEditor?.saving).toBe(true)
  press("return")
  expect(save).toHaveBeenCalledTimes(1)
  await settlePending()
  expect(ui.state.settingsEditor?.saving).toBe(false)
  press("return")
  await settlePending()
  expect(save).toHaveBeenCalledTimes(2)
  expect(ui.state.settingsEditor).toBeNull()
})

test("a failed import releases committing; preview controls stay blocked until it answers", async () => {
  data.init(":memory:")
  const pending = deferred<string>()
  const commit = spyOn(data, "commitPreview").mockReturnValueOnce(pending.promise).mockResolvedValue("Imported")
  const suggest = spyOn(data, "suggestCategories").mockResolvedValue(0)
  onTestFinished(() => { commit.mockRestore(); suggest.mockRestore() })
  ui.beginImport("", [])
  ui.setState("importWizard", { stage: "preview", preview: buildImportPreview(data.getDb()!, '01/02/2026,"-5.00",COFFEE\n', "anz.csv", DEFAULT_IMPORT_PROFILES[0]!) })
  press("s")
  for (const name of ["s", "a", "r", "p", "escape"]) press(name)
  expect(commit).toHaveBeenCalledTimes(1)
  expect(ui.state.importWizard).toMatchObject({ stage: "preview", committing: true, previewRules: true, previewShowAll: false })
  pending.reject(new Error("commit failed"))
  await settlePending()
  expect(ui.state.importWizard?.committing).toBe(false)
  press("s")
  await settlePending()
  expect(ui.state.importWizard).toBeNull()
})

test("a failed tag application closes the picker; Escape waits for the application", async () => {
  data.init(":memory:")
  const pending = deferred<string>()
  const apply = spyOn(data, "applyTagPatch").mockReturnValue(pending.promise)
  onTestFinished(() => apply.mockRestore())
  ui.openTagPicker([1])
  ui.setState("tagPicker", { patch: { 1: "add" } })
  press("return")
  expect(ui.state.tagPicker?.applying).toBe(true)
  press("escape")
  expect(ui.state.tagPicker?.applying).toBe(true)
  pending.reject(new Error("application failed"))
  await settlePending()
  expect(ui.state.tagPicker).toBeNull()
})

test("a failed reset releases busy; Escape closes while a reset is pending", async () => {
  data.init(":memory:")
  const pending = deferred<void>()
  const reset = spyOn(data, "factoryResetDatabase").mockRejectedValueOnce(new Error("reset failed")).mockReturnValue(pending.promise)
  onTestFinished(() => reset.mockRestore())
  ui.setState({ factoryReset: { draft: "RESET", caret: 5, busy: false } })
  press("return")
  press("return")
  expect(reset).toHaveBeenCalledTimes(1)
  await settlePending()
  expect(ui.state.factoryReset?.busy).toBe(false)
  press("return")
  expect(ui.state.factoryReset?.busy).toBe(true)
  press("escape")
  expect(ui.state.factoryReset).toBeNull()
  pending.resolve()
  await settlePending()
  expect(ui.state.factoryReset).toBeNull()
})

for (const action of ["make", "decline"] as const) {
  test(`a failed rule ${action} releases busy and permits a retry`, async () => {
    data.init(":memory:")
    const offer: RuleOffer = { source: "repeat", categoryId: 1, tagId: null, description: "Coffee", expr: 'desc:"Coffee"', times: 3, categorised: 3, agreeing: 3, waiting: [], others: [] }
    const offers = spyOn(data, "allRuleOffers").mockReturnValue([offer])
    const make = spyOn(data, "makeOfferedRule").mockRejectedValueOnce(new Error("make failed")).mockResolvedValue("Made rule")
    const decline = spyOn(data, "declineRuleOffer").mockRejectedValueOnce(new Error("decline failed")).mockResolvedValue(undefined)
    onTestFinished(() => { offers.mockRestore(); make.mockRestore(); decline.mockRestore() })
    ui.setState({ ruleOffers: { cursor: 0, busy: false } })
    const name = action === "make" ? "return" : "x"
    press(name)
    expect(ui.state.ruleOffers?.busy).toBe(true)
    press("return")
    expect(action === "make" ? make : decline).toHaveBeenCalledTimes(1)
    await settlePending()
    expect(ui.state.ruleOffers?.busy).toBe(false)
    press(name)
    await settlePending()
    expect(ui.state.ruleOffers?.busy).toBe(false)
    press("escape")
    expect(ui.state.ruleOffers).toBeNull()
  })
}
