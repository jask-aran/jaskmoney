import { afterEach, expect, onTestFinished, spyOn, test } from "bun:test"
import { rmSync } from "node:fs"
import type { AuthInteraction } from "@earendil-works/pi-ai"
import { credentialsPath, loadSavedCredentials } from "../ai/credentials"
import { activeLlmProvider, DEFAULT_LLM_MODEL, llmAuth, llmModelId } from "../ai/llm"
import { createFileCredentialStore, oauthPath } from "../ai/oauthStore"
import { aiActionHint, aiActions, aiContext, aiRow } from "../state/aiDialog"
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

test("enter opens a row's dialog; the pane's rows say what, how connected, and what for", () => {
  setup()
  testEnv("JASKMONEY_CF_TOKEN", "cf-token"); testEnv("JASKMONEY_CF_ACCOUNT_ID", "acct")
  data.refreshApiKeys()
  const ctx = aiContext(data)
  expect(aiRow("jev", ctx)).toEqual({ name: "Jev", connected: false, how: "not set", uses: "suggestions · ask:" })
  expect(aiRow("workersAi", ctx)).toMatchObject({ connected: true, how: "key · .env" })
  handleKey(ui, key("return"), data)
  expect(ui.activeScope()).toBe("settings.aiDialog")
  expect(ui.state.aiDialog).toMatchObject({ row: "jev", cursor: 0 })
  handleKey(ui, key("escape"), data)
  expect(ui.state.aiDialog).toBeNull()
})

test("a key: typed or pasted into the dialog, saved owner-only, used before .env; test and remove appear; remove takes enter twice", () => {
  setup()
  handleKey(ui, key("return"), data)
  expect(actions()).toEqual(["key"])
  choose("key")
  expect(handlePaste(ui, `${KEY}\n`, data)).toBe(true)
  expect(ui.state.aiDialog!.field).toMatchObject({ action: "key", value: KEY })
  handleKey(ui, key("return"), data)
  expect(ui.state.aiDialog!.field).toBeNull()
  expect(ui.state.aiDialog!.note).toEqual({ text: "Key saved", ok: true })
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_JEV_TOKEN: KEY })
  expect(data.state.apiKeys.JASKMONEY_JEV_TOKEN).toEqual({ source: "saved", mask: "•••• 9999" })
  expect(actions()).toEqual(["key", "test", "remove"])
  // An empty key leaves the saved one.
  choose("key")
  handleKey(ui, key("return"), data)
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_JEV_TOKEN: KEY })
  choose("remove")
  expect(ui.state.aiDialog!.armed).toBe(true)
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_JEV_TOKEN: KEY })
  handleKey(ui, key("return"), data)
  expect(loadSavedCredentials()).toEqual({})
  expect(data.state.apiKeys.JASKMONEY_JEV_TOKEN.source).toBeNull()
})

test("Workers AI: a token and an account id, each its own action", () => {
  setup(1)
  handleKey(ui, key("return"), data)
  expect(actions()).toEqual(["key", "accountId"])
  choose("key"); handlePaste(ui, KEY, data); handleKey(ui, key("return"), data)
  choose("accountId"); handlePaste(ui, "acct-for-test", data); handleKey(ui, key("return"), data)
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_CF_TOKEN: KEY, JASKMONEY_CF_ACCOUNT_ID: "acct-for-test" })
  expect(aiRow("workersAi", aiContext(data))).toMatchObject({ connected: true, how: "key · saved" })
})

test("a general model: browser sign-in first; its model checked against the provider; the default isn't saved; u-style 'use' picks it", () => {
  setup(3)
  handleKey(ui, key("return"), data)
  expect(actions()).toEqual(["signIn", "key", "model"])
  choose("model")
  expect(ui.state.aiDialog!.field).toMatchObject({ action: "model", value: "gpt-6.1-sol" })
  handleKey(ui, key("u", { ctrl: true }), data)
  handlePaste(ui, "unknown/model-for-test", data)
  handleKey(ui, key("return"), data)
  expect(ui.state.aiDialog!.note).toEqual({ text: "OpenAI has no model unknown/model-for-test", ok: false })
  expect(loadSavedCredentials()).toEqual({})
  handleKey(ui, key("u", { ctrl: true }), data)
  handlePaste(ui, "gpt-6-luna", data)
  handleKey(ui, key("return"), data)
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_OPENAI_MODEL: "gpt-6-luna" })
  choose("model"); handleKey(ui, key("u", { ctrl: true }), data); handlePaste(ui, "gpt-6.1-sol", data); handleKey(ui, key("return"), data)
  expect(loadSavedCredentials()).toEqual({})
  // OpenRouter set up and so in use: OpenAI, once it has a key, can take over.
  data.saveApiKeys({ JASKMONEY_OPENROUTER_TOKEN: "or-key-for-test" })
  choose("key"); handlePaste(ui, KEY, data); handleKey(ui, key("return"), data)
  expect(actions()).toEqual(["signIn", "key", "model", "test", "use", "remove"])
  choose("use")
  expect(activeLlmProvider()).toBe("openai")
  expect(aiRow("openai", aiContext(data)).uses).toBe("rules · in use")
  expect(actions()).not.toContain("use")
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
  data.saveApiKeys(saved)
  await createFileCredentialStore().modify("openrouter", async () => ({ type: "oauth", access: "a", refresh: "", expires: Date.now() + 60_000 }))
  data.refreshApiKeys()
  handleKey(ui, key("return"), data)
  choose("remove"); handleKey(ui, key("return"), data)
  await Bun.sleep(0)
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_JEV_TOKEN: KEY, JASKMONEY_OPENAI_TOKEN: KEY })
  expect(data.state.signedIn.openrouter).toBe(false)
})

test("OpenRouter's sign-in says it makes a key on the account, and removing doesn't revoke it", async () => {
  setup()
  await createFileCredentialStore().modify("openrouter", async () => ({ type: "oauth", access: "a", refresh: "", expires: Date.now() + 60_000 }))
  data.refreshApiKeys()
  const ctx = aiContext(data)
  expect(aiActionHint("openrouter", "signIn", ctx)).toContain("another one: the last stays active until you delete it on openrouter.ai")
  expect(aiActionHint("openrouter", "remove", ctx)).toBe("Forgets the sign-in here. Its key stays active on OpenRouter: delete it at openrouter.ai/settings/keys.")
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
  expect(ui.state.status).toBe("Signed in to OpenAI")
  expect(data.state.signedIn.openai).toBe(true)
  expect(llmAuth("openai")).toBe("signed in")
  expect(aiRow("openai", aiContext(data))).toMatchObject({ connected: true, how: "signed in" })
  expect(JSON.stringify(data.state.apiKeys)).not.toContain("access-for-test")

  const hanging = startLlmSignIn(ui, data, "openrouter", () => {}, { login: (_p: string, _t: string, i: AuthInteraction) => new Promise((_, reject) => i.signal?.addEventListener("abort", () => reject(new Error("aborted")))) } as never)
  await Bun.sleep(0)
  handleKey(ui, key("escape"), data)
  await hanging
  expect(ui.state.llmSignIn).toBeNull()
  expect(ui.state.status).toBe("OpenRouter sign-in cancelled")
})

test("without its own key, the Jev row shows it goes through OpenRouter when that is connected", () => {
  const ctx = aiContext(data)
  const signedIn = { ...ctx, signedIn: { openrouter: true, openai: false } }
  expect(aiRow("jev", ctx).how).toBe("not set")
  expect(aiRow("jev", signedIn)).toMatchObject({ connected: true, how: "via OpenRouter" })
})
