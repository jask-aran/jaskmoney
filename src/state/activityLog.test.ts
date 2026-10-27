import { expect, onTestFinished, spyOn, test } from "bun:test"
import { loadCategoryLog, loadTagLog, saveSuggestions } from "../db/client"
import { setAppClock } from "../domain/days"
import { assignProviderCategories, syncCategoryTree } from "../up/categories"
import { testEnv } from "../testing/scoped"
import { data } from "./dataStore"

/** Up rows: "bad" ones Up refuses (422); requests in flight are counted. */
function setup() {
  testEnv("JASKMONEY_UP_TOKEN", "test-pat")
  testEnv("JASKMONEY_JEV_TOKEN", "")
  let active = 0
  const seen = { most: 0 }
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(async (input: Parameters<typeof fetch>[0]) => {
    active++; seen.most = Math.max(seen.most, active)
    await new Promise((r) => setTimeout(r, 2))
    active--
    if (String(input).includes("/bad")) return new Response(JSON.stringify({ errors: [{ status: "422", title: "Nope", detail: "no" }] }), { status: 422 })
    return new Response(null, { status: 204 })
  }, { preconnect: globalThis.fetch.preconnect }))
  setAppClock(new Date("2026-10-27T10:00:00.000Z"))
  onTestFinished(() => { fetchMock.mockRestore(); setAppClock(null); data.init(":memory:") })
  data.init(":memory:")
  const db = data.getDb()!
  db.transaction(() => syncCategoryTree(db, [{ id: "home", name: "Home", parentId: null }, { id: "groceries", name: "Groceries", parentId: "home" }]))()
  const account = Number(db.query(`INSERT INTO accounts (name, source, external_id, external_kind) VALUES ('Spending', 'up', 'acc', 'TRANSACTIONAL')`).run().lastInsertRowid)
  const add = (ext: string, description = "Shop") => Number(db.query(`INSERT INTO transactions
    (date_raw, date_iso, amount, description, account_id, source, external_id, ext_categorizable) VALUES ('x', '2026-10-01', -5, ?, ?, 'up', ?, 1)`).run(description, account, ext).lastInsertRowid)
  const rows = ["a", "b", "c", "d", "e", "bad"].map((ext) => add(ext))
  assignProviderCategories(db)
  data.refresh()
  const cat = (name: string) => data.state.categories.find((c) => c.name === name)!.id
  return { db, rows, cat, seen }
}

test("each categorisation is logged with how and when; one Up refuses isn't", async () => {
  const { db, rows: [a, b, , , , bad], cat } = setup()
  const before = data.state.transactions.find((t) => t.id === a)!.categoryId
  await data.categorizeTransactions([a!, bad!], cat("Groceries"))
  saveSuggestions(db, [{ transactionId: b!, categoryId: cat("Groceries"), confidence: 0.9, source: "jev" }])
  data.refresh()
  await data.acceptSuggestions([b!])
  data.saveSavedFilter({ id: "shop", name: "Shop", expr: "desc:Shop" })
  data.createSettingsRule({ name: "Shop", savedFilterId: "shop", setCategoryId: cat("People"), addTagIds: [], enabled: true })
  data.applyRules([a!])
  expect(loadCategoryLog(db).map(({ transactionId, categoryId, previousCategoryId, how, at }) => [transactionId, categoryId, previousCategoryId, how, at])).toEqual([
    [a, cat("People"), cat("Groceries"), "rule", "2026-10-27T10:00:00.000Z"],
    [b, cat("Groceries"), before, "accept", "2026-10-27T10:00:00.000Z"],
    [a, cat("Groceries"), before, "choose", "2026-10-27T10:00:00.000Z"],
  ])
})

test("tag changes are logged by how; Up rows go in one batch, several at a time", async () => {
  const { db, rows, seen } = setup()
  const trip = data.createSettingsTag({ name: "Trip", color: "#fff", scope: null })
  const ok = rows.slice(0, 5)
  expect(await data.applyTagPatch(ok, { [trip]: "add" })).toBe("Tags: +TRIP on 5 · 5 updated in Up")
  expect(seen.most).toBeGreaterThan(1)
  await data.applyTagPatch([rows[0]!], { [trip]: "remove" })
  await data.openTagReview({ tagId: trip, name: "TRIP", scope: null }, { judge: async (qs) => Object.fromEntries(Object.keys(qs).map((id) => [id, { type: "noul" as const, noul: 0.9 }])) })
  await data.acceptTagCandidates([rows[0]!])
  const log = loadTagLog(db).map(({ transactionId, added, how }) => `${transactionId} ${added ? "+" : "-"} ${how}`)
  expect(log.slice(0, 2)).toEqual([`${rows[0]} + review`, `${rows[0]} - picker`])
  expect(log.slice(2).sort()).toEqual(ok.map((id) => `${id} + picker`).sort())
  data.closeTagReview()
})
