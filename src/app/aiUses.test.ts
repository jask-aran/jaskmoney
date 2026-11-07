import { afterEach, expect, onTestFinished, spyOn, test } from "bun:test"
import { rmSync } from "node:fs"
import { credentialsPath, loadSavedCredentials } from "../ai/credentials"
import { searchUsesClairic } from "../ai/workersAi"
import { filterGuide } from "../domain/filterLanguage"
import { previewSent } from "./sentPreview"
import { aiContext, useActions, useModel } from "../state/aiDialog"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"
import { handleKey } from "./keys"

/** Settings › AI models with a waiting row and a categorised one; Jev and
 * Clairic keys (never used: nothing may reach the network). */
async function setup() {
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
  await data.refreshApiKeys()
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

test("Search: Clairic switches off and on, saved as a setting", async () => {
  await setup()
  // The cursor passes Search's four queries before its model actions.
  ui.setState({ aiUse: { use: "search", cursor: 4, note: null } })
  expect(useActions("search", aiContext(data)).map((a) => a.id)).toEqual(["clairic"])
  handleKey(ui, key("return"), data)
  expect(loadSavedCredentials()).toEqual({ JASKMONEY_SEARCH_CLAIRIC: "off" })
  expect(searchUsesClairic()).toBe(false)
  expect(useModel("search", aiContext(data)).text).not.toContain("Clairic")
  handleKey(ui, key("return"), data)
  expect(loadSavedCredentials()).toEqual({})
  expect(searchUsesClairic()).toBe(true)
})

test("enter on a query opens it: its exact request is built by the real code, for your rows, and sent nowhere; keys left out", async () => {
  await setup()
  ui.setState({ aiUse: { use: "suggestions", cursor: 0, note: null } })
  handleKey(ui, key("return"), data)
  expect(ui.state.aiSent?.query).toBe("suggestion")
  const part = await until(() => ui.state.aiSent?.part)
  const suggestion = part.body as { model: string; questions: Record<string, { instructions: { transaction: { description: string } } }> }
  expect(part.to).toBe("POST https://api.typesafe.ai/v1/systemone")
  expect(part.sample).toContain("Corner Bar")
  expect(suggestion.model).toBe("jev-1.14.0")
  expect(Object.values(suggestion.questions)[0]!.instructions.transaction.description).toBe("Corner Bar")
  handleKey(ui, key("escape"), data)
  expect(ui.state.aiSent).toBeNull()
  expect(ui.state.aiUse?.use).toBe("suggestions")

  const search = await previewSent("search", data, { smartQuestion: "corner bar last month", clairic: true })
  expect(search.map((p) => p.query)).toEqual(["searchTerms", "searchCategories", "clairic", "ask"])
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

  const all = JSON.stringify([part, search, rules])
  for (const secret of ["jev-key-for-test", "cf-key-for-test", "acct-for-test", "preview"]) expect(all).not.toContain(secret)
})
