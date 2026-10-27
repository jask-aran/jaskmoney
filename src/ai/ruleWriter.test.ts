import { expect, onTestFinished, test } from "bun:test"
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { handleKey } from "../app/keys"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"
import { ruleWriterBrief, writeRules } from "./ruleWriter"

/** CSV rows: Rent paid to "J Smith" (4, all Rent), "Transfer to Holiday" (2 Travel, 1 Rent), "Bills Co" (2). */
function setup() {
  testEnv("JASKMONEY_OPENROUTER_TOKEN", "")
  data.init(":memory:")
  onTestFinished(() => data.init(":memory:"))
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  const cat = (name: string) => Number(db.query("INSERT INTO categories (name, color) VALUES (?, '#fff')").run(name).lastInsertRowid)
  const rent = cat("Test rent"), travel = cat("Test travel")
  let n = 0
  const add = (description: string, categoryId: number | null, amount = -500) =>
    db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, category_id, account_id, source) VALUES ('x', ?, ?, ?, ?, 100, 'csv')").run(`2026-10-${String(++n).padStart(2, "0")}`, amount, description, categoryId)
  for (let i = 0; i < 4; i++) add("J Smith", rent)
  add("J Smith", null)
  add("Transfer to Holiday", travel); add("Transfer to Holiday", travel); add("Transfer to Holiday", rent)
  add("Bills Co", rent); add("Bills Co", rent)
  data.refresh()
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  return { db, rent, travel, faux, llm: { models, model: faux.getModel() } }
}

const proposals = [
  { name: "Rent to J Smith", category: "Test rent", expr: 'desc:"J Smith"', why: "4 of 4 categorised are rent" },
  { name: "Holiday transfers", category: "Test travel", expr: 'desc:"Transfer to Holiday"', why: "mostly travel" },
  { name: "Bills", category: "Test rent", expr: "desc:Bills", why: "2 rows" },
  { name: "Nope", category: "Nothing", expr: "desc:x", why: "?" },
  { name: "Asks", category: "Test rent", expr: 'ask:"rent"', why: "?" },
]

test("the model's proposals are checked: only precise rules with enough rows are offered, with their reason", async () => {
  const { faux, llm, rent } = setup()
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("test_rule", { expr: 'desc:"J Smith"', category: "Test rent" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxToolCall("finish", { rules: proposals })], { stopReason: "toolUse" }),
  ])
  expect(await data.askForRules(llm)).toStartWith("faux-1 proposed 1 rule, 4 turned down by the check")
  const [offer] = data.state.aiRuleOffers
  expect(offer).toMatchObject({ source: "ai", description: "Rent to J Smith", expr: 'desc:"J Smith"', categoryId: rent, agreeing: 4, categorised: 4, why: "4 of 4 categorised are rent" })
  expect(offer!.waiting).toHaveLength(1)
  expect(data.allRuleOffers()).toEqual([offer!])
  // Made: the waiting row is categorised, the offer goes.
  expect(await data.makeOfferedRule(offer!)).toStartWith("Rule made: Rent to J Smith → Test rent · 1 waiting row categorised")
  expect(data.allRuleOffers()).toEqual([])
})

test("a declined AI rule isn't offered again, and the model is told", async () => {
  const { faux, llm, rent } = setup()
  const finish = () => fauxAssistantMessage([fauxToolCall("finish", { rules: [proposals[0]] })], { stopReason: "toolUse" })
  faux.setResponses([finish()])
  await data.askForRules(llm)
  data.declineRuleOffer(data.state.aiRuleOffers[0]!)
  expect(data.allRuleOffers()).toEqual([])
  expect(ruleWriterBrief(data.historyData(), [{ expr: 'desc:"J Smith"', categoryId: rent, tagId: null }]).declined).toEqual([{ expr: 'desc:"J Smith"', category: "Test rent" }])
  faux.setResponses([finish()])
  expect(await data.askForRules(llm)).toStartWith("faux-1 proposed 0 rules, 1 turned down")
})

test("the brief: categories with recent choices, what's waiting, existing rules", async () => {
  setup()
  const brief = ruleWriterBrief(data.historyData(), [])
  expect(brief.categories.find((c) => c.name === "Test rent")).toEqual({ name: "Test rent", rows: 7 })
  expect(brief.waiting.descriptions[0]).toMatchObject({ description: "J Smith", rows: 1 })
})

test("R opens the list with a key to ask, and says how offers come without one", () => {
  setup()
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions" })
  handleKey(ui, key("r", { shift: true }), data)
  expect(ui.state.ruleOffersOpen).toBe(false)
  testEnv("JASKMONEY_OPENROUTER_TOKEN", "test-key")
  handleKey(ui, key("r", { shift: true }), data)
  expect(ui.state.ruleOffersOpen).toBe(true)
  expect(ui.state.status).toBe("No rules offered yet · enter asks the AI")
  handleKey(ui, key("escape"), data)
})

test("a rule for rows Up already categorises (none waiting) is turned down; history reads are capped", async () => {
  const { db, faux, llm, travel } = setup()
  for (let i = 0; i < 3; i++) db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, category_id, category_source, account_id, source) VALUES ('x', '2026-09-01', -9, 'Qantas', ?, 'provider', 100, 'csv')").run(travel)
  data.refresh()
  faux.setResponses([
    fauxAssistantMessage(Array.from({ length: 11 }, () => fauxToolCall("category_history", { category: "Test travel" })), { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxToolCall("finish", { rules: [{ name: "Qantas", category: "Test travel", expr: "desc:Qantas", why: "3 of 3" }] })], { stopReason: "toolUse" }),
  ])
  const result = await writeRules(llm, data.historyData())
  expect(result.rejected).toEqual([{ rule: expect.objectContaining({ expr: "desc:Qantas" }), reason: "Up already categorises these" }])
  expect(result.calls.filter((c) => c.name === "category_history")).toHaveLength(11)
})
