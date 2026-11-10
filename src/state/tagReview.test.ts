import { expect, onTestFinished, spyOn, test } from "bun:test"
import type { JevClient, JevQuestion } from "../ai/jev"
import { testEnv } from "../testing/scoped"
import { data } from "./dataStore"
import { ui } from "./uiStore"

function setup() {
  testEnv("JASKMONEY_JEV_TOKEN", "")
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => { throw new Error("network is forbidden") }, { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => {
    try { expect(network).not.toHaveBeenCalled() } finally { network.mockRestore() }
  })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  const add = (id: number, description: string, dateISO = "2026-10-01") =>
    db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (?, ?, ?, -5, ?, 100, 'csv')").run(id, dateISO, dateISO, description)
  add(1, "Hilltop Coffee"); add(2, "Hilltop Coffee"); add(3, "Click Coffee"); add(4, "Bunnings"); add(5, "Old Coffee", "2025-01-01")
  data.refresh()
  data.setState({ accountSelection: "all" })
  ui.switchTab("manager")
  ui.setState({ focusedSection: "mgr.transactions", managerCursor: 0, managerTop: 0, selectedIds: {}, range: null })
  onTestFinished(() => { data.closeTagReview(); data.init(":memory:") })
  return { db }
}

function fakeJev() {
  const sent: string[] = []
  const states: unknown[] = []
  const ai: Pick<JevClient, "judge"> = { async judge(questions, state) {
    expect(state).toMatchObject({ tag: expect.any(String) })
    states.push(state)
    const d = (q: JevQuestion) => (q.instructions as { transaction: { description: string } }).transaction.description
    sent.push(...Object.values(questions).map(d))
    return Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, { type: "noul" as const, noul: /coffee/i.test(d(q)) ? 0.9 : 0.1 }]))
  } }
  return { ai, sent, states }
}

function food(db: ReturnType<typeof setup>["db"]): number {
  const id = Number(db.query("INSERT INTO categories (name, color) VALUES ('Food', '#fff')").run().lastInsertRowid)
  db.query("UPDATE transactions SET category_id = ? WHERE id <= 4").run(id)
  data.refresh()
  return id
}
const shown = () => data.scopedTransactions().map((t) => t.id)

test("a tag's review: tag history first, Jev for the rest of its categories, told what it's about; y tags, x dismisses for the session, esc leaves", async () => {
  const { db } = setup()
  const categoryIds = [food(db)]
  const coffee = await data.createSettingsTag({ name: "COFFEE", color: "#ffffff", categoryIds, about: "coffee out, not beans" })
  await data.applyTagPatch([1], { [coffee]: "add" })
  const { ai, sent, states } = fakeJev()
  await data.openTagReview({ tagId: coffee, name: "COFFEE", categoryIds, about: "coffee out, not beans" }, ai)
  expect(sent.sort()).toEqual(["Bunnings", "Click Coffee", "Hilltop Coffee"])
  expect(states[0]).toMatchObject({ about: "coffee out, not beans" })
  expect(shown().sort()).toEqual([2, 3])
  expect(data.state.tagReview!.candidates[2]).toMatchObject({ source: "jev", confidence: 0.9 })
  await data.dismissTagCandidates([3])
  expect(shown()).toEqual([2])
  await data.openTagReview({ tagId: coffee, name: "COFFEE", categoryIds, about: null }, ai)
  expect(shown()).toEqual([2])
  expect(await data.acceptTagCandidates([2])).toContain("+COFFEE")
  expect(data.state.transactions.find((t) => t.id === 2)!.tagIds).toContain(coffee)
  expect(shown()).toEqual([])
  data.closeTagReview()
  expect(data.state.tagReview).toBeNull()
  expect(data.state.sortColumn).toBe("date")
})
