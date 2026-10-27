import { expect, onTestFinished, spyOn, test } from "bun:test"
import { loadCategoryLog, saveSuggestions } from "../db/client"
import { footerHints, handleKey } from "../app/keys"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"
import { data } from "./dataStore"
import { ui } from "./uiStore"

/**
 * Acceptance tests for undo (u) and repeat (.) — frozen: change the code,
 * not these. CSV rows (nothing goes to Up) unless a test says otherwise.
 */
function setup() {
  testEnv("JASKMONEY_JEV_TOKEN", "")
  testEnv("JASKMONEY_UP_TOKEN", "")
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => { throw new Error("network is forbidden") }, { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => { network.mockRestore(); data.closeTagReview(); data.init(":memory:") })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  const cat = (name: string) => Number(db.query("INSERT INTO categories (name, color) VALUES (?, '#fff')").run(name).lastInsertRowid)
  const food = cat("Test food"), fuel = cat("Test fuel")
  const add = (id: number, description: string, categoryId: number | null = null) =>
    db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, category_id, account_id, source) VALUES (?, 'x', ?, -5, ?, ?, 100, 'csv')").run(id, `2026-10-${String(id).padStart(2, "0")}`, description, categoryId)
  add(1, "Shop"); add(2, "Shop"); add(3, "Shop"); add(4, "Garage", fuel); add(5, "Cafe")
  data.refresh()
  data.setAccountSelection("all")
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0, selectedIds: {}, rangeSelecting: false })
  const row = (id: number) => data.state.transactions.find((t) => t.id === id)!
  return { db, food, fuel, row }
}

test("undo reverses the last categorisation, newest first, and its rule-offer count; then there's nothing to undo", async () => {
  const { food, fuel, row } = setup()
  expect(data.undoLabel()).toBeNull()
  expect(await data.undo()).toBe("Nothing to undo")
  await data.categorizeTransactions([1, 2, 3], food)
  await data.categorizeTransactions([4], food)
  expect(data.ruleOffersFor().map((o) => o.description)).toEqual(["Shop"])
  expect(data.undoLabel()).toBe("categorised 1 → Test food")
  expect(await data.undo()).toStartWith("Undid: categorised 1 → Test food")
  expect(row(4).categoryId).toBe(fuel)
  expect(await data.undo()).toStartWith("Undid: categorised 3 → Test food")
  expect([1, 2, 3].map((id) => row(id).categoryId)).toEqual([null, null, null])
  // Undone choices don't count toward a rule offer.
  expect(data.ruleOffersFor()).toEqual([])
  expect(loadCategoryLog(data.getDb()!)[0]).toMatchObject({ transactionId: expect.any(Number), how: "undo" })
  expect(data.undoLabel()).toBeNull()
})

test("undoing an accept puts the rows back waiting, with their suggestions; undoing a dismiss brings the suggestion back", async () => {
  const { db, food, row } = setup()
  saveSuggestions(db, [
    { transactionId: 1, categoryId: food, confidence: 0.91, source: "jev" },
    { transactionId: 5, categoryId: food, confidence: 0.6, source: "jev" },
  ])
  data.refresh()
  await data.acceptSuggestions([1])
  expect(row(1).categoryId).toBe(food)
  expect(data.state.suggestions[1]).toBeUndefined()
  expect(await data.undo()).toStartWith("Undid: accepted 1 suggestion")
  expect(row(1).categoryId).toBeNull()
  expect(data.state.suggestions[1]).toMatchObject({ categoryId: food, confidence: 0.91 })
  data.dismissSuggestions([5])
  expect(data.state.suggestions[5]).toBeUndefined()
  expect(await data.undo()).toStartWith("Undid: dismissed 1 suggestion")
  expect(data.state.suggestions[5]).toMatchObject({ categoryId: food, confidence: 0.6 })
})

test("undo reverses tag changes from the picker and the tag review, and a tag review dismissal", async () => {
  const { row } = setup()
  const trip = data.createSettingsTag({ name: "TRIP", color: "#fff", scope: null })
  await data.applyTagPatch([1, 2], { [trip]: "add" })
  expect(await data.undo()).toStartWith("Undid: +TRIP on 2")
  expect(row(1).tagIds).toEqual([])
  const ai = { judge: async (qs: Record<string, unknown>) => Object.fromEntries(Object.keys(qs).map((id) => [id, { type: "noul" as const, noul: 0.9 }])) }
  await data.openTagReview({ tagId: trip, name: "TRIP", scope: null }, ai)
  await data.acceptTagCandidates([3])
  expect(row(3).tagIds).toEqual([trip])
  expect(await data.undo()).toStartWith("Undid: +TRIP on 1")
  expect(row(3).tagIds).toEqual([])
  data.dismissTagCandidates([5])
  expect(data.state.tagReview!.candidates[5]).toBeUndefined()
  expect(await data.undo()).toStartWith("Undid: dismissed 1 candidate")
  expect(data.state.tagReview!.candidates[5]).toMatchObject({ confidence: 0.9 })
})

test("undoing a rule made from an offer removes the rule and its filter, and puts the rows it categorised back", async () => {
  const { food, row } = setup()
  await data.categorizeTransactions([1, 2], food)
  await data.categorizeTransactions([3], food)
  data.getDb()!.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (6, 'x', '2026-10-06', -5, 'Shop', 100, 'csv')").run()
  data.refresh()
  const [offer] = data.ruleOffersFor()
  await data.makeOfferedRule(offer!)
  expect(row(6).categoryId).toBe(food)
  const rules = data.state.rules.length
  expect(await data.undo()).toStartWith("Undid: rule Shop → Test food")
  expect(data.state.rules.length).toBe(rules - 1)
  expect(data.state.savedFilters.some((f) => f.expr === offer!.expr)).toBe(false)
  expect(row(6).categoryId).toBeNull()
})

test("u undoes in Transactions; esc still clears; the footer says u undo", async () => {
  const { food, row } = setup()
  await data.categorizeTransactions([1], food)
  ui.setState({ selectedIds: { 2: true } })
  handleKey(ui, key("escape"), data)
  expect(ui.state.selectedIds).toEqual({})
  expect(row(1).categoryId).toBe(food)
  handleKey(ui, key("u"), data)
  await Bun.sleep(5)
  expect(row(1).categoryId).toBeNull()
  expect(ui.state.status).toStartWith("Undid: categorised 1 → Test food")
  const hints = footerHints("manager.txns", { focusedSection: "mgr.transactions", drillReturn: null, chartViews: [0, 4] }).map((h) => `${h.key} ${h.desc}`)
  expect(hints).toContain("u undo")
  expect(hints).toContain("esc clear")
  expect(hints.some((h) => h.startsWith("esc/u"))).toBe(false)
})

test(". repeats the last category or tag change on the cursor row or selection; the picker starts on the last category", async () => {
  const { food, fuel, row } = setup()
  const trip = data.createSettingsTag({ name: "TRIP", color: "#fff", scope: null })
  const at = (id: number) => ui.setState({ managerCursor: data.scopedTransactions().findIndex((t) => t.id === id), selectedIds: {} })
  // Nothing to repeat yet.
  at(1)
  handleKey(ui, key("."), data)
  expect(ui.state.status).toBe("Nothing to repeat")
  // Categorise row 1 with the picker, then . on row 2.
  at(1)
  handleKey(ui, key("c"), data)
  for (const ch of "Test fuel") handleKey(ui, key(ch === " " ? "space" : ch), data)
  handleKey(ui, key("return"), data)
  await Bun.sleep(5)
  expect(row(1).categoryId).toBe(fuel)
  at(2)
  handleKey(ui, key("."), data)
  await Bun.sleep(5)
  expect(row(2).categoryId).toBe(fuel)
  // The picker opens on the last category for a row with no suggestion.
  at(3)
  handleKey(ui, key("c"), data)
  expect(ui.state.catPickerOpen).toBe(true)
  const fuelIndex = ui.state.catPickerCursor
  handleKey(ui, key("return"), data)
  await Bun.sleep(5)
  expect(row(3).categoryId).toBe(fuel)
  expect(fuelIndex).toBeGreaterThan(0)
  // A tag change is repeatable too, on a selection.
  await data.applyTagPatch([1], { [trip]: "add" })
  ui.setState({ selectedIds: { 4: true, 5: true } })
  handleKey(ui, key("."), data)
  await Bun.sleep(5)
  expect([row(4).tagIds, row(5).tagIds]).toEqual([[trip], [trip]])
  void food
})
