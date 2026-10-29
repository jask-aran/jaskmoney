import { afterEach, expect, onTestFinished, spyOn, test } from "bun:test"
import { rmSync } from "node:fs"
import { credentialsPath, loadSavedCredentials } from "../ai/credentials"
import { searchUsesClairic } from "../ai/workersAi"
import { filterGuide } from "../domain/filterLanguage"
import { AI_ROWS } from "./apiKeys"
import { previewSent } from "./sentPreview"
import { aiContext, useActions, useModel } from "../state/aiDialog"
import { data } from "../state/dataStore"
import { sentLines } from "../state/sentView"
import { ui } from "../state/uiStore"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"
import { handleKey } from "./keys"

/** Settings › AI models with a waiting row and a categorised one; Jev and
 * Clairic keys (never used: nothing may reach the network). */
function setup() {
  testEnv("JASKMONEY_JEV_TOKEN", "jev-key-for-test")
  testEnv("JASKMONEY_CF_TOKEN", "cf-key-for-test"); testEnv("JASKMONEY_CF_ACCOUNT_ID", "acct-for-test")
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => { throw new Error("network is forbidden") }, { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => { try { expect(network).not.toHaveBeenCalled() } finally { network.mockRestore() } })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO categories (id, name, color) VALUES (100, 'Test food', '#fff')").run()
  db.query(`INSERT INTO transactions (id, date_raw, date_iso, amount, description, category_id, account_id, source)
    VALUES (1, '2026-10-01', '2026-10-01', -5, 'Bulk Barn', 100, 100, 'csv'), (2, '2026-10-02', '2026-10-02', -12, 'Corner Bar', NULL, 100, 'csv')`).run()
  data.refresh()
  data.refreshApiKeys()
  ui.switchTab("settings")
  ui.activateSettings("ai")
  ui.setState({ aiCursor: 0, aiDialog: null, aiUse: null, aiSent: null })
  onTestFinished(() => { ui.setState({ aiUse: null, aiSent: null }); data.init(":memory:") })
}
afterEach(() => rmSync(credentialsPath(), { force: true }))

async function until<T>(get: () => T | null | undefined): Promise<T> {
  for (let i = 0; i < 200; i++) {
    const value = get()
    if (value) return value
    await Bun.sleep(5)
  }
  throw new Error("timed out")
}

test("the pane's rows are the models, then the uses; a use names its model and enter opens it", () => {
  setup()
  const ctx = aiContext(data)
  expect(useModel("suggestions", ctx)).toEqual({ text: "Jev (TypeSafe)", ready: true })
  expect(useModel("search", ctx)).toEqual({ text: "Jev (TypeSafe) + Clairic", ready: true })
  expect(useModel("rules", ctx)).toEqual({ text: "OpenRouter: not connected", ready: false })
  expect(useActions("rules", ctx).map((a) => a.label)).toEqual(["Connect OpenRouter…", "Connect OpenAI…", "Show exactly what's sent"])
  // j past the last model reaches the uses.
  for (let i = 0; i < AI_ROWS.length + 1; i++) handleKey(ui, key("j"), data)
  handleKey(ui, key("return"), data)
  expect(ui.state.aiUse).toEqual({ use: "search", cursor: 0, note: null })
  expect(ui.state.aiDialog).toBeNull()
})

test("Search: Clairic switches off and on, saved as a setting", () => {
  setup()
  ui.setState({ aiUse: { use: "search", cursor: 0, note: null } })
  expect(useActions("search", aiContext(data)).map((a) => a.id)).toEqual(["clairic", "view"])
  handleKey(ui, key("return"), data)
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_SEARCH_CLAIRIC: "off" })
  expect(searchUsesClairic()).toBe(false)
  expect(useModel("search", aiContext(data)).text).toBe("Jev (TypeSafe)")
  handleKey(ui, key("return"), data)
  expect(loadSavedCredentials()).toEqual({})
  expect(searchUsesClairic()).toBe(true)
})

test("a use's Connect opens that model's dialog", () => {
  setup()
  ui.setState({ aiUse: { use: "rules", cursor: 1, note: null } })
  handleKey(ui, key("return"), data)
  expect(ui.state.aiUse).toBeNull()
  expect(ui.state.aiDialog?.row).toBe("openai")
  expect(ui.state.aiCursor).toBe(AI_ROWS.indexOf("openai"))
  ui.setState({ aiDialog: null })
})

test("what's sent is built by the real code, for your rows, and sent nowhere; keys left out", async () => {
  setup()
  ui.setState({ aiUse: { use: "suggestions", cursor: 0, note: null } })
  handleKey(ui, key("return"), data)
  const parts = await until(() => ui.state.aiSent?.parts)
  expect(parts.map((p) => p.title)).toEqual(["Category suggestion", "Merchant check"])
  const suggestion = parts[0]!.body as { model: string; questions: Record<string, { instructions: { transaction: { description: string } } }> }
  expect(parts[0]!.to).toBe("POST https://api.typesafe.ai/v1/systemone")
  expect(suggestion.model).toBe("jev-1.14.0")
  // The newest waiting row.
  expect(Object.values(suggestion.questions)[0]!.instructions.transaction.description).toBe("Corner Bar")
  handleKey(ui, key("escape"), data)
  expect(ui.state.aiSent).toBeNull()
  expect(ui.state.aiUse?.use).toBe("suggestions")

  const search = await previewSent("search", data, { smartQuestion: "corner bar last month", clairic: true })
  expect(search.map((p) => p.title)).toEqual(["Smart search (?corner bar last month)", "Smart search: categories", "Smart search: Clairic", 'ask:"coffee"'])
  // The account holder's examples go with the category questions, as with suggestions.
  expect((search[0]!.body as { state: unknown }).state).toEqual({ search: "corner bar last month" })
  expect((search[1]!.body as { state: unknown }).state).toEqual({ search: "corner bar last month", categories_used_for: { "Test food": ["Bulk Barn"] } })
  expect(search[2]!.to).toBe("POST https://api.cloudflare.com/client/v4/accounts/<your account>/ai/run/@cf/cloudflare/clairic")

  const rules = await previewSent("rules", data, { clairic: false })
  const context = rules[0]!.body as { system: string; messages: Array<{ role: string; content: string }>; tools: Array<{ name: string }> }
  expect(context.system).toContain(filterGuide())
  expect(Object.keys(context.messages[0]!)).toEqual(["role", "content"])
  expect(JSON.parse(context.messages[0]!.content).waiting).toBeDefined()
  expect(context.tools.map((t) => t.name)).toEqual(["category_history", "tag_history", "test_rule", "waiting", "finish"])

  const all = JSON.stringify([parts, search, rules])
  for (const secret of ["jev-key-for-test", "cf-key-for-test", "acct-for-test", "preview"]) expect(all).not.toContain(secret)
})

test("the viewer's outline: fields indented, long text wrapped, a family of questions shown once, JSON text as its fields", () => {
  const questions = Object.fromEntries([["period", { type: "choice" }], ...[1, 2, 3, 4].map((n) => [`kind${n}`, { type: "noul", instructions: `Does it cover c${n}?` }])])
  const lines = sentLines([{ title: "T", when: "now", to: "POST https://x", body: { state: { search: "coffee" }, questions, prompt: JSON.stringify({ waiting: 3, categories: [{ name: "Food", rows: 2 }] }), long: "word ".repeat(30).trim() } }], 40)
  const text = lines.map((l) => l.map((p) => p.text).join(""))
  expect(text.slice(0, 3)).toEqual(["T", "Sent now.", "POST https://x"])
  expect(text).toContain("  state:")
  expect(text).toContain("    search: coffee")
  expect(text).toContain("      instructions: Does it cover c1?")
  expect(text.join(" ").replace(/\s+/g, " ")).toContain("… 3 more like it (kind2 to kind4), each the same with its own subject")
  expect(text.join("\n")).not.toContain("c2?")
  expect(text).toContain("  prompt: (sent as JSON text)")
  expect(text).toContain("    waiting: 3")
  expect(text).toContain('      [0]: {"name":"Food","rows":2}')
  const examples = sentLines([{ title: "T", when: "now", to: "x", body: { categories_used_for: { Groceries: ["Coles", "Aldi"] } } }], 60).map((l) => l.map((p) => p.text).join(""))
  expect(examples).toContain('    Groceries: ["Coles","Aldi"]')
  expect(Math.max(...text.map((l) => l.length))).toBeLessThanOrEqual(40)
  expect(text.filter((l) => l.trim().startsWith("word")).length).toBeGreaterThan(3)
})
