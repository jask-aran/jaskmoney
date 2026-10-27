import { expect, onTestFinished, spyOn, test } from "bun:test"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { data } from "./dataStore"
import { ui } from "./uiStore"
import { assignProviderCategories, syncCategoryTree } from "../up/categories"
import { handleKey } from "../app/keys"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"

/** Up rows (a fake Up answering 204), Groceries in Up's tree, Fuel local. */
function setup() {
  testEnv("JASKMONEY_UP_TOKEN", "test-pat")
  testEnv("JASKMONEY_JEV_TOKEN", "")
  const calls: string[] = []
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    calls.push(String(input).replace("https://api.up.com.au/api/v1/transactions/", ""))
    return new Response(null, { status: 204 })
  }, { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => { fetchMock.mockRestore(); data.init(":memory:") })
  const path = join(mkdtempSync(join(tmpdir(), "jm-")), "t.db")
  data.init(path)
  const db = data.getDb()!
  db.transaction(() => syncCategoryTree(db, [
    { id: "home", name: "Home", parentId: null },
    { id: "groceries", name: "Groceries", parentId: "home" },
  ]))()
  db.query("INSERT INTO categories (name, color) VALUES ('Test fuel', '#fff')").run()
  const account = Number(db.query(`INSERT INTO accounts (name, source, external_id, external_kind) VALUES ('Spending', 'up', 'acc', 'TRANSACTIONAL')`).run().lastInsertRowid)
  let n = 0
  const add = (description: string) => Number(db.query(`INSERT INTO transactions
    (date_raw, date_iso, amount, description, account_id, source, external_id, ext_categorizable)
    VALUES ('x', '2026-10-01', -5, ?, ?, 'up', ?, 1)`).run(description, account, `e${++n}`).lastInsertRowid)
  const ids = { coles: [add("Coles"), add("Coles"), add("COLES "), add("Coles")], express: add("Coles Express"), aldi: [add("Aldi"), add("Aldi"), add("Aldi")] }
  assignProviderCategories(db)
  data.refresh()
  data.setAccountSelection("all")
  const cat = (name: string) => data.state.categories.find((c) => c.name === name)!.id
  const source = (id: number) => (db.query("SELECT category_source AS s FROM transactions WHERE id = ?").get(id) as { s: string | null }).s
  return { db, ids, cat, calls, path, source }
}

test("a rule is offered after the third time a description goes in one category, and making it categorises the waiting row in Up too", async () => {
  const { ids, cat, calls, source } = setup()
  const [a, b, c, waiting] = ids.coles
  expect(await data.categorizeTransactions([a!, b!], cat("Groceries"))).toBe("Categorized 2 → Groceries · 2 updated in Up")
  expect(data.ruleOffersFor()).toEqual([])
  // Spelling and case don't split a description.
  expect(await data.categorizeTransactions([c!], cat("Groceries"))).toBe("Categorized 1 → Groceries · 1 updated in Up · R: rule for Coles → Groceries")
  const [offer] = data.ruleOffersFor()
  expect(offer).toMatchObject({ description: "Coles", expr: 'desc:"Coles"', times: 3, categorised: 3, agreeing: 3, waiting: [waiting!, ids.express], others: ["Coles Express"] })
  calls.length = 0
  expect(await data.makeOfferedRule(offer!)).toBe("Rule made: Coles → Groceries · 2 waiting rows categorised · 2 sent to Up")
  expect(calls.sort()).toEqual([`e4/relationships/category`, `e5/relationships/category`])
  expect(source(waiting!)).toBe("provider")
  expect(data.state.savedFilters.find((f) => f.id === "desc-coles")).toEqual({ id: "desc-coles", name: "Coles", expr: 'desc:Coles' })
  expect(data.state.rules.at(-1)).toMatchObject({ name: "Coles → Groceries", savedFilterId: "desc-coles", setCategoryId: cat("Groceries"), enabled: true })
  // Covered now: not offered again.
  expect(data.ruleOffersFor()).toEqual([])
})

test("no offer when the filter finds rows elsewhere (Coles Express in Fuel), and one declined stays declined", async () => {
  const { ids, cat, path } = setup()
  await data.categorizeTransactions([ids.express], cat("Test fuel"))
  await data.categorizeTransactions(ids.coles.slice(0, 3), cat("Groceries"))
  // desc:Coles finds Coles Express too: 3 of 4 categorised in Groceries.
  expect(data.ruleOffersFor()).toEqual([])
  await data.categorizeTransactions(ids.aldi, cat("Groceries"))
  const [aldi] = data.ruleOffersFor()
  expect(aldi!.description).toBe("Aldi")
  data.declineRuleOffer(aldi!)
  data.init(path)
  expect(data.ruleOffersFor()).toEqual([])
})

test("a rule's category on an Up row Up can hold waits to go to Up; a local-only one stays the rule's", () => {
  const { ids, cat, source } = setup()
  data.saveSavedFilter({ id: "aldi", name: "Aldi", expr: "desc:Aldi" })
  data.saveSavedFilter({ id: "express", name: "Express", expr: 'desc:"Coles Express"' })
  data.createSettingsRule({ name: "Aldi", savedFilterId: "aldi", setCategoryId: cat("Groceries"), addTagIds: [], enabled: true })
  data.createSettingsRule({ name: "Express", savedFilterId: "express", setCategoryId: cat("Test fuel"), addTagIds: [], enabled: true })
  data.applyRules([...ids.aldi, ids.express])
  expect(ids.aldi.map(source)).toEqual(["pending", "pending", "pending"])
  expect(source(ids.express)).toBe("rule")
})

test("R opens the offers; x declines the cursor's; esc closes", async () => {
  const { ids, cat } = setup()
  await data.categorizeTransactions(ids.aldi, cat("Groceries"))
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions" })
  handleKey(ui, key("r", { shift: true }), data)
  expect(ui.state.ruleOffersOpen).toBe(true)
  expect(ui.activeScope()).toBe("manager.ruleOffers")
  handleKey(ui, key("x"), data)
  expect(ui.state.ruleOffersOpen).toBe(false)
  expect(ui.state.status).toBe("No rule for Aldi; it won't be offered again")
  handleKey(ui, key("r", { shift: true }), data)
  expect(ui.state.ruleOffersOpen).toBe(false)
  expect(ui.state.status).toStartWith("No rule to offer")
})
