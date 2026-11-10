import { expect, onTestFinished, test } from "bun:test"
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai"
import { data } from "../state/dataStore"
import { testEnv } from "../testing/scoped"

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
  await data.askForRules(llm)
  const [offer] = data.state.aiRuleOffers
  expect(offer).toMatchObject({ source: "ai", description: "Rent to J Smith", expr: 'desc:"J Smith"', categoryId: rent, agreeing: 4, categorised: 4, why: "4 of 4 categorised are rent" })
  expect(offer!.waiting).toHaveLength(1)
  expect(data.allRuleOffers()).toEqual([offer!])
  await data.makeOfferedRule(offer!)
  expect(data.state.transactions.find((t) => t.id === offer!.waiting[0])?.categoryId).toBe(rent)
  expect(data.allRuleOffers()).toEqual([])
})
