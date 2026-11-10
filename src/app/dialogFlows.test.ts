import { afterEach, expect, spyOn, test } from "bun:test"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { DATABASE_ROWS } from "../state/databaseRows"
import { tagPickerItems } from "../state/tagPicker"
import { pickerChoices } from "../state/settingsForm"
import { key } from "../testing/keys"
import { settlePending } from "../testing/keys"
import { sources } from "./executorSource"
import { handleKey } from "./keys"
import type { ImportPreview, ImportProfile } from "../domain/types"

const restores: Array<() => void> = []
afterEach(() => {
  for (const restore of restores.splice(0)) restore()
  ui.reset()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

function spy<T extends object, K extends keyof T>(target: T, method: K) {
  const s = spyOn(target, method as never)
  restores.push(() => (s as { mockRestore(): void }).mockRestore())
  return s as unknown as ReturnType<typeof spyOn>
}

const profile: ImportProfile = { id: "bank", name: "Bank", account: "Spending", accountType: "debit", importPrefix: "bank", hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" }
const preview = { rows: [], accountName: "Spending", rulesEnabled: true } as unknown as ImportPreview

async function openImport() {
  data.init(":memory:")
  spy(data, "importDirectory").mockResolvedValue("/csv")
  spy(data, "csvFiles").mockResolvedValue(["/csv/a.csv"])
  spy(data, "profileMatches").mockReturnValue([profile])
  ui.switchTab("settings")
  ui.activateSettings("database")
  ui.setState({ databaseCursor: DATABASE_ROWS.indexOf("import") })
  handleKey(ui, key("return"), data); await settlePending()
  expect(ui.state.importWizard?.stage).toBe("files")
}

test("an import preview that arrives after the import was closed opens nothing: the tab shown keeps its keys", async () => {
  await openImport()
  const answer = deferred<ImportPreview>()
  spy(data, "previewImport").mockReturnValue(answer.promise)
  handleKey(ui, key("return"), data)
  handleKey(ui, key("escape"), data)
  handleKey(ui, key("1"), data)
  answer.resolve(preview); await settlePending()
  expect(ui.state.importWizard).toBeNull()
  expect(ui.activeScope()).toBe("overview")
})

test("a settings save that finishes after its editor closed leaves the next editor open", async () => {
  data.init(":memory:")
  ui.switchTab("settings")
  const answer = deferred<number>()
  spy(data, "createSettingsCategory").mockReturnValue(answer.promise)
  ui.openSettingsEditor("category", null, { ...ui.state.settingsDraft, name: "Coffee", color: "#123456" })
  handleKey(ui, key("return"), data)
  handleKey(ui, key("escape"), data)
  expect(ui.state.settingsEditor).toBeNull()
  ui.openSettingsEditor("tag", null, { ...ui.state.settingsDraft, name: "Holiday", color: "#654321" })
  answer.resolve(1); await settlePending()
  expect(ui.state.settingsEditor?.kind).toBe("tag")
  expect(ui.activeScope()).toBe("settings.editor")
})

test("esc while the tag picker is still making a new tag applies nothing", async () => {
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-01', -5, 'Shop', 100, 'csv')").run()
  data.refresh()
  ui.switchTab("manager")
  ui.openTagPicker([1])
  const query = "Brand new tag"
  const create = pickerChoices(tagPickerItems(data.state.tags, data.state.categories, data.transactions(), [1], query)).findIndex((item) => item.value === null)
  expect(create).toBeGreaterThanOrEqual(0)
  ui.setState("tagPicker", { query, cursor: create })
  const made = deferred<number>()
  spy(data, "createSettingsTag").mockReturnValue(made.promise)
  const apply = spy(data, "applyTagPatch")
  handleKey(ui, key("return"), data)
  handleKey(ui, key("escape"), data)
  expect(ui.state.tagPicker).toBeNull()
  made.resolve(99); await settlePending()
  expect(apply).not.toHaveBeenCalled()
  expect(ui.state.tagPicker).toBeNull()
})

test("esc while Executor's sign-in is starting stops it: no browser, and the dialog stays closed", async () => {
  ui.switchTab("settings")
  const opened: string[] = []
  const was = { ...sources }
  restores.push(() => Object.assign(sources, was))
  let signal: AbortSignal | undefined
  const started = deferred<void>()
  Object.assign(sources, {
    open: (url: string) => { opened.push(url) },
    status: async () => ({ signedIn: false, tools: [], error: null }),
    signIn: async (open: (url: string) => void, s: AbortSignal) => {
      signal = s
      await started.promise
      if (s.aborted) throw new Error("aborted")
      open("https://executor.example/sign-in")
    },
  })
  ui.setState({ executor: { status: { signedIn: false, tools: [], error: null }, cursor: 0, busy: null, waiting: null, note: null } })
  handleKey(ui, key("return"), data)
  await settlePending()
  expect(ui.state.executor?.busy).toBeTruthy()
  handleKey(ui, key("escape"), data)
  expect(ui.state.executor).toBeNull()
  expect(signal?.aborted).toBe(true)
  started.resolve(); await settlePending(); await settlePending()
  expect(opened).toEqual([])
  expect(ui.state.executor).toBeNull()
})

