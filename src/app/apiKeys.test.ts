import { afterEach, expect, onTestFinished, spyOn, test } from "bun:test"
import { rmSync } from "node:fs"
import { credentialsPath, loadSavedCredentials } from "../ai/credentials"
import { editorFields } from "../state/settingsForm"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"
import { handleKey, handlePaste } from "./keys"

const KEY = "apikey_27825a25560c4f14cbb9ab1b8762d8ce13a_test9999"

function setup() {
  testEnv("JASKMONEY_JEV_TOKEN", "")
  testEnv("JASKMONEY_CF_TOKEN", "")
  testEnv("JASKMONEY_CF_ACCOUNT_ID", "")
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => { throw new Error("network is forbidden") }, { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => { try { expect(network).not.toHaveBeenCalled() } finally { network.mockRestore() } })
  data.init(":memory:")
  ui.switchTab("settings")
  ui.activateSettings("ai")
  ui.setState({ aiCursor: 0 })
}
afterEach(() => rmSync(credentialsPath(), { force: true }))

test("AI models: enter opens the key editor; a pasted key is masked, saved owner-only, and used before .env", () => {
  setup()
  expect(data.state.apiKeys.JASKMONEY_JEV_TOKEN).toEqual({ source: null, mask: "" })
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsEditor).toBe("jevKey")
  expect(handlePaste(ui, `${KEY}\n`, data)).toBe(true)
  expect(ui.state.settingsDraft.secret).toBe(KEY)
  const field = editorFields("jevKey", ui.state.settingsDraft, { accounts: [], categories: [], tags: [], savedFilters: [] })[0]!
  expect(field.display).not.toContain(KEY.slice(0, 10))
  expect(field.display).toContain("…9999")
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsEditor).toBeNull()
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_JEV_TOKEN: KEY })
  expect(data.state.apiKeys.JASKMONEY_JEV_TOKEN).toEqual({ source: "saved", mask: "•••• 9999" })

  // Saving an empty key keeps the current one.
  handleKey(ui, key("return"), data)
  handleKey(ui, key("return"), data)
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_JEV_TOKEN: KEY })

  // del asks, del again removes the saved key.
  handleKey(ui, key("delete"), data)
  expect(ui.state.settingsConfirm).toMatchObject({ kind: "apiKey", id: "jev" })
  handleKey(ui, key("delete"), data)
  expect(loadSavedCredentials()).toEqual({})
  expect(data.state.apiKeys.JASKMONEY_JEV_TOKEN.source).toBeNull()
})

test("Workers AI takes a token and an account id; the account id is required", () => {
  setup()
  ui.setState({ aiCursor: 1 })
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsEditor).toBe("workersAiKey")
  handlePaste(ui, "cf-token-abcd", data)
  handleKey(ui, key("return"), data)
  expect(ui.state.status).toContain("account ID")
  handleKey(ui, key("tab"), data)
  handlePaste(ui, "acct-42", data)
  handleKey(ui, key("return"), data)
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_CF_TOKEN: "cf-token-abcd", JASKMONEY_CF_ACCOUNT_ID: "acct-42" })
})

test("a paste only types where input is text: never where letters are commands", () => {
  setup()
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions" })
  expect(handlePaste(ui, "xyi", data)).toBe(false)
  expect(data.state.uncategorisedOnly).toBe(false)
  handleKey(ui, key("/"), data)
  expect(handlePaste(ui, "desc:coffee\r\n", data)).toBe(true)
  expect(ui.state.filterDraft).toBe("desc:coffee")
  handleKey(ui, key("escape"), data)
})
