import { expect, onTestFinished, test } from "bun:test"
import { createModels, fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai"
import { data } from "../state/dataStore"
import { testEnv } from "../testing/scoped"
import { writeRules } from "./ruleWriter"

/**
 * Backlog 11, AI tag rules (acceptance, frozen): the rule writer can propose
 * a rule that adds a tag (`tag` instead of `category` in its proposal and in
 * test_rule), checked by the same bar on the tag (RULE_SHARE of the rows it
 * finds already carry the tag, RULE_AFTER or more of them, no rule already
 * adds it, not declined, not IGNORE). A tag offer has `tagId` and a null
 * `categoryId`; `waiting` is the rows it finds without the tag. Making it
 * creates a rule that adds the tag and tags the waiting rows; undo takes both
 * back. Declining is remembered like a category offer's.
 *
 * CSV rows: "Qantas" (9, tagged TRAVEL), "Qantas" (1, untagged), "Uber" (2
 * TRAVEL, 2 not), "Bunnings" (1 TRAVEL).
 */
function setup() {
  testEnv("JASKMONEY_OPENROUTER_TOKEN", "")
  data.init(":memory:")
  onTestFinished(() => data.init(":memory:"))
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  const travel = data.createSettingsTag({ name: "TRAVEL", color: "#89b4fa", scope: null })
  const ignore = data.state.tags.find((t) => t.name === "IGNORE")!.id
  let n = 0
  const add = (description: string, tagged: boolean) => {
    const id = Number(db.query("INSERT INTO transactions (date_raw, date_iso, amount, description, account_id, source) VALUES ('x', ?, -50, ?, 100, 'csv')")
      .run(`2026-10-${String(++n).padStart(2, "0")}`, description).lastInsertRowid)
    if (tagged) db.query("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (?, ?)").run(id, travel)
    return id
  }
  for (let i = 0; i < 9; i++) add("Qantas", true)
  const untagged = add("Qantas", false)
  add("Uber", true); add("Uber", true); add("Uber", false); add("Uber", false)
  add("Bunnings", true)
  data.refresh()
  const faux = fauxProvider()
  const models = createModels()
  models.setProvider(faux.provider)
  return { db, travel, ignore, untagged, faux, llm: { models, model: faux.getModel() } }
}

const proposals = [
  { name: "Qantas is travel", tag: "TRAVEL", expr: "desc:Qantas", why: "9 of 10 tagged" },
  { name: "Uber is travel", tag: "TRAVEL", expr: "desc:Uber", why: "half" },
  { name: "Bunnings", tag: "TRAVEL", expr: "desc:Bunnings", why: "1 row" },
  { name: "No such tag", tag: "NOPE", expr: "desc:Qantas", why: "?" },
  { name: "Ignore it", tag: "IGNORE", expr: "desc:Qantas", why: "?" },
]

const tagsOf = (id: number) => data.state.transactions.find((t) => t.id === id)!.tagIds

test("tag proposals are checked by the same bar; test_rule takes a tag", async () => {
  const { faux, llm, travel, untagged } = setup()
  faux.setResponses([
    fauxAssistantMessage([fauxToolCall("test_rule", { expr: "desc:Qantas", tag: "TRAVEL" })], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxToolCall("finish", { rules: proposals })], { stopReason: "toolUse" }),
  ])
  const result = await writeRules(llm, data.historyData())
  expect(result.error).toBeUndefined()
  expect(result.offers).toHaveLength(1)
  expect(result.offers[0]).toMatchObject({ source: "ai", description: "Qantas is travel", expr: "desc:Qantas", categoryId: null, tagId: travel, agreeing: 9, categorised: 10, waiting: [untagged], why: "9 of 10 tagged" })
  expect(result.rejected.map((r) => r.rule.name).sort()).toEqual(["Bunnings", "Ignore it", "No such tag", "Uber is travel"])
  // The model's test of a tag rule ran (an error would end the run with no offers).
  expect(result.calls.map((c) => c.name)).toContain("test_rule")
})

test("making a tag offer adds a rule that tags the waiting rows; undo takes both back", async () => {
  const { faux, llm, travel, untagged } = setup()
  faux.setResponses([fauxAssistantMessage([fauxToolCall("finish", { rules: proposals.slice(0, 1) })], { stopReason: "toolUse" })])
  await data.askForRules(llm)
  const offer = data.state.aiRuleOffers[0]!
  expect(offer.tagId).toBe(travel)
  const summary = await data.makeOfferedRule(offer)
  expect(summary).toContain("TRAVEL")
  const rule = data.state.rules.find((r) => r.addTagIds.includes(travel))!
  // A plain copy: Bun's toMatchObject rejects the store's proxy arrays.
  expect({ ...rule, addTagIds: [...rule.addTagIds] }).toMatchObject({ setCategoryId: null, addTagIds: [travel], enabled: true })
  expect(tagsOf(untagged)).toContain(travel)
  expect(data.state.aiRuleOffers).toHaveLength(0)
  await data.undo()
  expect(data.state.rules.some((r) => r.addTagIds.includes(travel))).toBe(false)
  expect(tagsOf(untagged)).not.toContain(travel)
})

test("a declined tag offer isn't offered again", async () => {
  const { faux, llm } = setup()
  faux.setResponses([fauxAssistantMessage([fauxToolCall("finish", { rules: proposals.slice(0, 1) })], { stopReason: "toolUse" })])
  await data.askForRules(llm)
  data.declineRuleOffer(data.state.aiRuleOffers[0]!)
  expect(data.state.aiRuleOffers).toHaveLength(0)
  faux.setResponses([fauxAssistantMessage([fauxToolCall("finish", { rules: proposals.slice(0, 1) })], { stopReason: "toolUse" })])
  expect(await data.askForRules(llm)).toStartWith("faux-1 proposed 0 rules, 1 turned down by the check")
  expect(data.state.aiRuleOffers).toHaveLength(0)
})
