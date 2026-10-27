import { afterEach, expect, onTestFinished, spyOn, test } from "bun:test"
import { rmSync } from "node:fs"
import { credentialsPath, loadSavedCredentials } from "../ai/credentials"
import type { AuthInteraction } from "@earendil-works/pi-ai"
import { activeLlmProvider, DEFAULT_LLM_MODEL, llmAuth, llmModelId } from "../ai/llm"
import { createFileCredentialStore, oauthPath } from "../ai/oauthStore"
import { startLlmSignIn } from "./llmSignIn"
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
  testEnv("JASKMONEY_OPENROUTER_TOKEN", "")
  for (const name of ["JASKMONEY_LLM_MODEL", "JASKMONEY_OPENROUTER_MODEL", "JASKMONEY_OPENAI_TOKEN", "JASKMONEY_OPENAI_MODEL", "JASKMONEY_LLM_PROVIDER"]) testEnv(name, "")
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => { throw new Error("network is forbidden") }, { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => { try { expect(network).not.toHaveBeenCalled() } finally { network.mockRestore() } })
  data.init(":memory:")
  ui.switchTab("settings")
  ui.activateSettings("ai")
  ui.setState({ aiCursor: 0 })
}
afterEach(() => { rmSync(credentialsPath(), { force: true }); rmSync(oauthPath(), { force: true }) })

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

test("OpenRouter opens with the current model; saving and del twice update both credentials", () => {
  setup()
  testEnv("JASKMONEY_OPENROUTER_MODEL", DEFAULT_LLM_MODEL)
  ui.setState({ aiCursor: 2 })
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsEditor).toBe("llmKey")
  expect(ui.state.settingsDraft.secret).toBe("")
  expect(ui.state.settingsDraft.model).toBe(llmModelId())
  const fields = editorFields("llmKey", ui.state.settingsDraft, { accounts: [], categories: [], tags: [], savedFilters: [] })
  expect(fields[1]).toMatchObject({ label: "Model", kind: "text", display: DEFAULT_LLM_MODEL })
  handlePaste(ui, KEY, data)
  const secret = editorFields("llmKey", ui.state.settingsDraft, { accounts: [], categories: [], tags: [], savedFilters: [] })[0]!
  expect(secret.kind).toBe("secret")
  expect(secret.display).not.toContain(KEY)
  expect(secret.display).toContain("…9999")
  ui.setState("settingsDraft", "model", "  meta/muse-spark-1.3  ")
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsEditor).toBeNull()
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_OPENROUTER_TOKEN: KEY, JASKMONEY_OPENROUTER_MODEL: "meta/muse-spark-1.3" })
  expect(data.state.apiKeys.JASKMONEY_OPENROUTER_TOKEN).toEqual({ source: "saved", mask: "•••• 9999" })
  expect(data.state.apiKeys.JASKMONEY_OPENROUTER_MODEL).toEqual({ source: "saved", mask: "meta/muse-spark-1.3" })

  handleKey(ui, key("return"), data)
  handleKey(ui, key("return"), data)
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_OPENROUTER_TOKEN: KEY, JASKMONEY_OPENROUTER_MODEL: "meta/muse-spark-1.3" })

  handleKey(ui, key("delete"), data)
  expect(ui.state.settingsConfirm).toMatchObject({ kind: "apiKey", id: "openrouter", label: "OpenRouter" })
  expect(loadSavedCredentials().JASKMONEY_OPENROUTER_TOKEN).toBe(KEY)
  handleKey(ui, key("delete"), data)
  expect(loadSavedCredentials()).toEqual({})
  expect(data.state.apiKeys.JASKMONEY_OPENROUTER_TOKEN.source).toBeNull()
  expect(data.state.apiKeys.JASKMONEY_OPENROUTER_MODEL.source).toBe("env")
})

test("OpenRouter refuses an unknown model before saving either credential", () => {
  setup()
  ui.setState({ aiCursor: 2 })
  handleKey(ui, key("return"), data)
  handlePaste(ui, KEY, data)
  ui.setState("settingsDraft", "model", "unknown/model-for-test")
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsEditor).toBe("llmKey")
  expect(ui.state.status).toBe("OpenRouter has no model unknown/model-for-test")
  expect(ui.state.statusErr).toBe(true)
  expect(loadSavedCredentials()).toEqual({})
  handleKey(ui, key("escape"), data)
})

test("OpenRouter saving an empty model removes the saved model and keeps the key", () => {
  setup()
  data.saveApiKeys({ JASKMONEY_OPENROUTER_TOKEN: KEY, JASKMONEY_OPENROUTER_MODEL: DEFAULT_LLM_MODEL })
  ui.setState({ aiCursor: 2 })
  handleKey(ui, key("return"), data)
  ui.setState("settingsDraft", "model", "  ")
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsEditor).toBeNull()
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_OPENROUTER_TOKEN: KEY })
  expect(llmModelId()).toBe(DEFAULT_LLM_MODEL)
})

test("AI key deletion removes only the selected provider's saved values", () => {
  setup()
  const saved = {
    JASKMONEY_JEV_TOKEN: KEY,
    JASKMONEY_CF_TOKEN: "cf-token-for-test",
    JASKMONEY_CF_ACCOUNT_ID: "acct-for-test",
    JASKMONEY_OPENROUTER_TOKEN: KEY,
    JASKMONEY_OPENROUTER_MODEL: DEFAULT_LLM_MODEL,
  }
  data.saveApiKeys(saved)
  ui.setState({ aiCursor: 2 })
  handleKey(ui, key("delete"), data)
  expect(loadSavedCredentials()).toEqual(saved)
  handleKey(ui, key("delete"), data)
  expect(loadSavedCredentials()).toEqual({
    JASKMONEY_JEV_TOKEN: KEY,
    JASKMONEY_CF_TOKEN: "cf-token-for-test",
    JASKMONEY_CF_ACCOUNT_ID: "acct-for-test",
  })

  data.saveApiKeys(saved)
  ui.setState({ aiCursor: 0 })
  handleKey(ui, key("delete"), data)
  handleKey(ui, key("delete"), data)
  expect(loadSavedCredentials()).toEqual({
    JASKMONEY_CF_TOKEN: "cf-token-for-test",
    JASKMONEY_CF_ACCOUNT_ID: "acct-for-test",
    JASKMONEY_OPENROUTER_TOKEN: KEY,
    JASKMONEY_OPENROUTER_MODEL: DEFAULT_LLM_MODEL,
  })

  data.saveApiKeys(saved)
  ui.setState({ aiCursor: 1 })
  handleKey(ui, key("delete"), data)
  handleKey(ui, key("delete"), data)
  expect(loadSavedCredentials()).toEqual({
    JASKMONEY_JEV_TOKEN: KEY,
    JASKMONEY_OPENROUTER_TOKEN: KEY,
    JASKMONEY_OPENROUTER_MODEL: DEFAULT_LLM_MODEL,
  })
})

test("OpenAI: its own key and model; u uses it; a former JASKMONEY_LLM_MODEL still names OpenRouter's model", () => {
  setup()
  ui.setState({ aiCursor: 3 })
  handleKey(ui, key("u"), data)
  expect(ui.state.status).toBe("OpenAI has no key or sign-in yet · enter adds a key, o signs in")
  handleKey(ui, key("return"), data)
  expect(ui.state.settingsDraft).toMatchObject({ provider: "openai", model: "gpt-6.1-sol" })
  handlePaste(ui, KEY, data)
  handleKey(ui, key("return"), data)
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_OPENAI_TOKEN: KEY })
  handleKey(ui, key("u"), data)
  expect(loadSavedCredentials().JASKMONEY_LLM_PROVIDER).toBe("openai")
  expect(activeLlmProvider()).toBe("openai")
  testEnv("JASKMONEY_LLM_MODEL", "meta/muse-spark-1.2")
  expect(llmModelId(undefined, "openrouter")).toBe("meta/muse-spark-1.2")
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
  expect(JSON.stringify(data.state.apiKeys)).not.toContain("access-for-test")

  const hanging = startLlmSignIn(ui, data, "openrouter", () => {}, { login: (_p: string, _t: string, i: AuthInteraction) => new Promise((_, reject) => i.signal?.addEventListener("abort", () => reject(new Error("aborted")))) } as never)
  await Bun.sleep(0)
  handleKey(ui, key("escape"), data)
  await hanging
  expect(ui.state.llmSignIn).toBeNull()
  expect(ui.state.status).toBe("OpenRouter sign-in cancelled")

  // del twice on the OpenAI row forgets the sign-in.
  ui.setState({ aiCursor: 3 })
  handleKey(ui, key("delete"), data)
  handleKey(ui, key("delete"), data)
  await Bun.sleep(0)
  expect(data.state.signedIn.openai).toBe(false)
})
