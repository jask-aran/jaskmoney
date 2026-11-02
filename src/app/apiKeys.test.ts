import { settlePending } from "../testing/settle"
import { afterEach, expect, onTestFinished, spyOn, test } from "bun:test"
import { rmSync } from "node:fs"
import type { AuthInteraction } from "@earendil-works/pi-ai"
import { credentialsPath, loadSavedCredentials } from "../ai/credentials"
import { activeLlmProvider, DEFAULT_LLM_MODEL, llmAuth, llmModelId } from "../ai/llm"
import { createFileCredentialStore, oauthPath } from "../ai/oauthStore"
import { aiActionHint, aiActions, aiContext, aiRow, useActions, useModel } from "../state/aiDialog"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"
import { handleKey, handlePaste } from "./keys"
import { startLlmSignIn } from "./llmSignIn"

const KEY = "apikey_27825a25560c4f14cbb9ab1b8762d8ce13a_test9999"

/** Settings › AI models focused on `row`; no keys, no network. */
function setup(row = 0) {
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => { throw new Error("network is forbidden") }, { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => { try { expect(network).not.toHaveBeenCalled() } finally { network.mockRestore() } })
  data.init(":memory:")
  ui.switchTab("settings")
  ui.activateSettings("ai")
  ui.setState({ aiCursor: row, aiDialog: null })
  onTestFinished(() => ui.setState({ aiDialog: null }))
}
afterEach(() => { rmSync(credentialsPath(), { force: true }); rmSync(oauthPath(), { force: true }) })

const actions = () => aiActions(ui.state.aiDialog!.row, aiContext(data)).map((a) => a.id)
/** Move the dialog's cursor to an action and press enter. */
function choose(action: string) {
  const at = actions().indexOf(action as never)
  expect(at).toBeGreaterThanOrEqual(0)
  ui.setState("aiDialog", { cursor: at })
  handleKey(ui, key("return"), data)
}

test("enter opens a row's dialog; the pane's rows say what, how connected, and what for", async () => {
  setup()
  testEnv("JASKMONEY_CF_TOKEN", "cf-token"); testEnv("JASKMONEY_CF_ACCOUNT_ID", "acct")
  await data.refreshApiKeys()
  const ctx = aiContext(data)
  expect(aiRow("jev", ctx)).toEqual({ name: "Jev", connected: false, how: "not set" })
  expect(aiRow("workersAi", ctx)).toMatchObject({ connected: true, how: "key · env" })
  handleKey(ui, key("return"), data)
  expect(ui.activeScope()).toBe("settings.aiDialog")
  expect(ui.state.aiDialog).toMatchObject({ row: "jev", cursor: 0 })
  handleKey(ui, key("escape"), data)
  expect(ui.state.aiDialog).toBeNull()
})

test("a key: typed or pasted into the dialog, saved owner-only, used before .env; test and remove appear; remove takes enter twice", async () => {
  setup()
  handleKey(ui, key("return"), data)
  expect(actions()).toEqual(["key"])
  choose("key")
  expect(handlePaste(ui, `${KEY}\n`, data)).toBe(true)
  expect(ui.state.aiDialog!.field).toMatchObject({ action: "key", value: KEY })
  handleKey(ui, key("return"), data); await settlePending()
  expect(ui.state.aiDialog!.field).toBeNull()
  expect(ui.state.aiDialog!.note?.ok).toBe(true)
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_JEV_TOKEN: KEY })
  // Where it comes from, and not one character of it.
  expect(data.state.apiKeys.JASKMONEY_JEV_TOKEN).toEqual({ source: "saved", mask: "" })
  expect(actions()).toEqual(["key", "test", "remove"])
  // An empty key leaves the saved one.
  choose("key")
  handleKey(ui, key("return"), data)
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_JEV_TOKEN: KEY })
  choose("remove")
  expect(ui.state.armed).toMatchObject({ kind: "aiKey", id: "jev" })
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_JEV_TOKEN: KEY })
  handleKey(ui, key("return"), data); await settlePending()
  expect(loadSavedCredentials()).toEqual({})
  expect(data.state.apiKeys.JASKMONEY_JEV_TOKEN.source).toBeNull()
})

test("Workers AI: a token and an account id, each its own action", async () => {
  setup(1)
  handleKey(ui, key("return"), data)
  expect(actions()).toEqual(["key", "page", "accountId"])
  choose("key"); handlePaste(ui, KEY, data); handleKey(ui, key("return"), data); await settlePending()
  // The token's account is found from it (testSetup's made-up one) …
  expect(ui.state.aiDialog!.note?.ok).toBe(true)
  expect(loadSavedCredentials()).toMatchObject({ JASKMONEY_CF_ACCOUNT_ID: "acct-test" })
  // … and can still be entered by hand.
  choose("accountId")
  expect(ui.state.aiDialog!.field).toMatchObject({ action: "accountId", value: "acct-test" })
  handleKey(ui, key("u", { ctrl: true }), data); handlePaste(ui, "acct-for-test", data); handleKey(ui, key("return"), data); await settlePending()
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_CF_TOKEN: KEY, JASKMONEY_CF_ACCOUNT_ID: "acct-for-test" })
  expect(aiRow("workersAi", aiContext(data))).toMatchObject({ connected: true, how: "key · saved" })
})

test("a general model: browser sign-in first; its model chosen from the provider's list; the default isn't saved; u-style 'use' picks it", async () => {
  setup(3)
  handleKey(ui, key("return"), data)
  expect(actions()).toEqual(["signIn", "key", "page", "model"])
  // The model: a list of the provider's (pi-ai's catalog), on the one in use.
  choose("model")
  expect(ui.activeScope()).toBe("modelPicker")
  expect(ui.state.modelPicker).toMatchObject({ provider: "openai", query: "", cursor: 0 })
  handlePaste(ui, "gpt-6-luna", data)
  handleKey(ui, key("return"), data); await settlePending()
  expect(ui.state.modelPicker).toBeNull()
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_OPENAI_MODEL: "gpt-6-luna" })
  // Nothing the provider doesn't list can be chosen.
  choose("model"); handlePaste(ui, "unknown/model-for-test", data)
  handleKey(ui, key("return"), data); await settlePending()
  expect(ui.state.modelPicker).not.toBeNull()
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_OPENAI_MODEL: "gpt-6-luna" })
  // The recommended one, first: nothing saved, it follows the app's default.
  ui.setState("modelPicker", { query: "", cursor: 0 })
  handleKey(ui, key("return"), data); await settlePending()
  expect(loadSavedCredentials()).toEqual({})
  // OpenRouter set up and so in use: OpenAI, once it has a key, can take
  // over, from the Rules use (a model's dialog only connects it).
  await data.saveApiKeys({ JASKMONEY_OPENROUTER_TOKEN: "or-key-for-test" })
  choose("key"); handlePaste(ui, KEY, data); handleKey(ui, key("return"), data); await settlePending()
  expect(actions()).toEqual(["signIn", "key", "page", "model", "test", "remove"])
  // Past the Rules use's one query and its model, the switch.
  ui.setState({ aiDialog: null, aiUse: { use: "rules", cursor: 2, note: null } })
  expect(useActions("rules", aiContext(data)).map((a) => a.id)).toEqual(["model", "provider"])
  handleKey(ui, key("return"), data); await settlePending()
  expect(activeLlmProvider()).toBe("openai")
  expect(useModel("rules", aiContext(data)).ready).toBe(true)
  expect(useActions("rules", aiContext(data))[1]).toMatchObject({ id: "provider", provider: "openrouter" })
  ui.setState({ aiUse: null })
})

test("a former JASKMONEY_LLM_MODEL still names OpenRouter's model", () => {
  setup()
  testEnv("JASKMONEY_LLM_MODEL", "meta/muse-spark-1.2")
  expect(llmModelId(undefined, "openrouter")).toBe("meta/muse-spark-1.2")
  testEnv("JASKMONEY_LLM_MODEL", "")
  expect(llmModelId(undefined, "openrouter")).toBe(DEFAULT_LLM_MODEL)
})

test("removing a general model removes only its key, model and sign-in", async () => {
  setup(2)
  const saved = { JASKMONEY_JEV_TOKEN: KEY, JASKMONEY_OPENROUTER_TOKEN: KEY, JASKMONEY_OPENROUTER_MODEL: "meta/muse-spark-1.3", JASKMONEY_OPENAI_TOKEN: KEY }
  await data.saveApiKeys(saved)
  await createFileCredentialStore().modify("openrouter", async () => ({ type: "oauth", access: "a", refresh: "", expires: Date.now() + 60_000 }))
  await data.refreshApiKeys()
  handleKey(ui, key("return"), data)
  choose("remove"); handleKey(ui, key("return"), data); await settlePending()
  await Bun.sleep(0)
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_JEV_TOKEN: KEY, JASKMONEY_OPENAI_TOKEN: KEY })
  expect(data.state.signedIn.openrouter).toBe(false)
})

test("browser sign-in: the address opens, a pasted redirect URL is sent, the sign-in is stored and shown; esc cancels", async () => {
  setup()
  const opened: string[] = []
  let sent = ""
  const login = async (provider: string, _type: string, interaction: AuthInteraction) => {
    interaction.notify({ type: "auth_url", url: "https://example.test/authorize?x=1" })
    sent = await interaction.prompt({ type: "manual_code", message: "Paste the redirect URL:" })
    await createFileCredentialStore().modify(provider, async () => ({ type: "oauth", access: "access-for-test", refresh: "refresh-for-test", expires: Date.now() + 60_000 }))
    return { type: "oauth" as const, access: "", refresh: "", expires: 0 }
  }
  const running = startLlmSignIn(ui, data, "openai", (url) => opened.push(url), { login } as never)
  await Bun.sleep(0)
  expect(opened).toEqual(["https://example.test/authorize?x=1"])
  expect(ui.activeScope()).toBe("llmSignIn")
  expect(ui.state.llmSignIn).toMatchObject({ provider: "openai", url: "https://example.test/authorize?x=1", paste: { message: "Paste the redirect URL:" } })
  handlePaste(ui, "http://127.0.0.1:1455/auth/callback?code=abc", data)
  handleKey(ui, key("return"), data)
  await running
  expect(sent).toBe("http://127.0.0.1:1455/auth/callback?code=abc")
  expect(ui.state.llmSignIn).toBeNull()
  expect(data.state.signedIn.openai).toBe(true)
  expect(llmAuth("openai")).toBe("signed in")
  expect(aiRow("openai", aiContext(data))).toMatchObject({ connected: true, how: "signed in" })
  expect(JSON.stringify(data.state.apiKeys)).not.toContain("access-for-test")

  const hanging = startLlmSignIn(ui, data, "openrouter", () => {}, { login: (_p: string, _t: string, i: AuthInteraction) => new Promise((_, reject) => i.signal?.addEventListener("abort", () => reject(new Error("aborted")))) } as never)
  await Bun.sleep(0)
  handleKey(ui, key("escape"), data)
  await hanging
  expect(ui.state.llmSignIn).toBeNull()
  expect(data.state.signedIn.openrouter).toBe(false)
})

test("OpenRouter's sign-in says it makes a key on the account, and removing doesn't revoke it", async () => {
  setup()
  await createFileCredentialStore().modify("openrouter", async () => ({ type: "oauth", access: "a", refresh: "", expires: Date.now() + 60_000 }))
  await data.refreshApiKeys()
  const ctx = aiContext(data)
  expect(aiActionHint("openrouter", "signIn", ctx)).toContain("another one: the last stays active until you delete it on openrouter.ai")
  expect(aiActionHint("openrouter", "remove", ctx)).toBe("Forgets the sign-in here. Its key stays active on OpenRouter: delete it at openrouter.ai/settings/keys.")
})

test("without its own key, the Jev row shows it goes through OpenRouter when that is connected", () => {
  const ctx = aiContext(data)
  const signedIn = { ...ctx, signedIn: { openrouter: true, openai: false } }
  expect(aiRow("jev", ctx).how).toBe("not set")
  expect(aiRow("jev", signedIn)).toMatchObject({ connected: true, how: "via OpenRouter" })
})

test("Settings › Up Bank: enter on the token row opens its dialog; a pasted token is saved owner-only, shown masked, and removed on enter twice", async () => {
  data.init(":memory:")
  ui.switchTab("settings")
  ui.activateSettings("up")
  ui.setState({ upCursor: 0, aiDialog: null })
  handleKey(ui, key("return"), data)
  expect(ui.state.aiDialog).toMatchObject({ row: "up", cursor: 0 })
  const ctx = () => aiContext(data)
  expect(aiActions("up", ctx()).map((a) => a.id)).toEqual(["key"])
  handleKey(ui, key("return"), data)
  expect(ui.state.aiDialog?.field?.action).toBe("key")
  handlePaste(ui, "up:yeah:test-token-1234", data)
  handleKey(ui, key("return"), data); await settlePending()
  expect(loadSavedCredentials().JASKMONEY_UP_TOKEN).toBe("up:yeah:test-token-1234")
  expect(aiRow("up", ctx())).toMatchObject({ connected: true, how: "key · saved" })
  expect(aiActions("up", ctx()).map((a) => a.id)).toEqual(["key", "test", "remove"])
  ui.setState("aiDialog", { cursor: 2 })
  handleKey(ui, key("return"), data)
  expect(loadSavedCredentials().JASKMONEY_UP_TOKEN).toBe("up:yeah:test-token-1234")
  handleKey(ui, key("return"), data); await settlePending()
  expect(loadSavedCredentials().JASKMONEY_UP_TOKEN).toBeUndefined()
  ui.setState({ aiDialog: null })
})

test("on the dialog's actions, a paste is the key: straight away, its letters never moving the cursor", async () => {
  setup()
  handleKey(ui, key("return"), data)
  expect(ui.state.aiDialog).toMatchObject({ row: "jev", cursor: 0, field: null })
  expect(handlePaste(ui, "jjjj-key-for-test\n", data)).toBe(true)
  expect(ui.state.aiDialog).toMatchObject({ cursor: 0, field: { action: "key", value: "jjjj-key-for-test" } })
  handleKey(ui, key("return"), data); await settlePending()
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_JEV_TOKEN: "jjjj-key-for-test" })
})

test("a paste keeps an emoji whole and drops colour codes (OpenTUI's stripAnsiSequences)", () => {
  setup()
  handleKey(ui, key("return"), data)
  choose("key")
  expect(handlePaste(ui, "\x1b[31mkey-🏖️-for-test\x1b[0m\n", data)).toBe(true)
  expect(ui.state.aiDialog!.field).toMatchObject({ value: "key-🏖️-for-test" })
})
