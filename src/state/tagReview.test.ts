import { expect, onTestFinished, spyOn, test } from "bun:test"
import type { JevClient, JevQuestion } from "../ai/jev"
import { groupForTag } from "../domain/tagSuggest"
import type { TagGroup } from "../domain/tagGroups"
import { handleKey } from "../app/keys"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"
import { data } from "./dataStore"
import { tagChoices } from "./tagChooser"
import { ui } from "./uiStore"

/** CSV rows (tagging never calls Up), no Jev key, no network. */
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

/** A fake Jev: coffee rows 0.9, the rest 0.1; `sent` gets each row's description. */
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

/** A Food category with rows 1–4 in it (row 5, the old one, stays uncategorised). */
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
  // Row 1 has the tag; row 5 isn't in Food; neither is asked about.
  expect(sent.sort()).toEqual(["Bunnings", "Click Coffee", "Hilltop Coffee"])
  expect(states[0]).toMatchObject({ about: "coffee out, not beans" })
  // Most sure first; Bunnings (0.1) isn't shown.
  expect(shown().sort()).toEqual([2, 3])
  expect(data.state.tagReview!.candidates[2]).toMatchObject({ source: "jev", confidence: 0.9 })
  // x: gone for the session, even after reopening.
  await data.dismissTagCandidates([3])
  expect(shown()).toEqual([2])
  await data.openTagReview({ tagId: coffee, name: "COFFEE", categoryIds, about: null }, ai)
  expect(shown()).toEqual([2])
  // y: tagged, and out of the review.
  expect(await data.acceptTagCandidates([2])).toContain("+COFFEE")
  expect(data.state.transactions.find((t) => t.id === 2)!.tagIds).toContain(coffee)
  expect(shown()).toEqual([])
  data.closeTagReview()
  expect(data.state.tagReview).toBeNull()
  expect(data.state.sortColumn).toBe("date")
})

test("a trip's review looks within its dates whatever the tag's categories", async () => {
  const { db } = setup()
  const categoryIds = [food(db)]
  const trip: TagGroup = { kind: "trip", name: "Lisbon Jan 2025", detail: "3 in person · 1 Jan 2025", rows: [], start: "2025-01-01", end: "2025-01-01" }
  const { ai, sent } = fakeJev()
  await data.openTagReview({ tagId: null, name: "LISBON 2025", categoryIds, about: null, group: trip }, ai)
  expect(sent).toEqual(["Old Coffee"])
})

test("a new tag is created on its first accept, for any category", async () => {
  setup()
  const { ai } = fakeJev()
  await data.openTagReview({ tagId: null, name: "Coffee runs", categoryIds: [], about: null }, ai)
  // Tag names are upper case: the review names it as it will be.
  expect(data.state.tagReview!.name).toBe("COFFEE RUNS")
  expect(data.state.tags.some((t) => t.name === "COFFEE RUNS")).toBe(false)
  await data.acceptTagCandidates([1])
  const tag = data.state.tags.find((t) => t.name === "COFFEE RUNS")!
  expect({ categoryIds: [...tag.categoryIds], about: tag.about }).toEqual({ categoryIds: [], about: null })
  expect(data.state.tagReview!.tagId).toBe(tag.id)
})

test("the chooser: your tags (a trip found for one), groups no tag covers, then a new name; IGNORE isn't offered", async () => {
  setup()
  const trip: TagGroup = { kind: "trip", name: "Singapore May 2026", detail: "38 in person · 22–25 May 2026", rows: [], start: "2026-05-22", end: "2026-05-25" }
  const subs: TagGroup = { kind: "recurring", name: "Subscriptions", detail: "Netflix monthly", rows: [] }
  expect(groupForTag("SINGAPORE 2026", [trip])).toBe(trip)
  expect(groupForTag("SINGAPORE 2025", [trip])).toBeUndefined()
  expect(groupForTag("Japan", [trip])).toBeUndefined()
  await data.createSettingsTag({ name: "SINGAPORE 2026", color: "#fff", categoryIds: [], about: null })
  const choices = tagChoices(data.state.tags, [trip, subs], "")
  expect(choices.map((c) => c.kind === "tag" ? `tag ${c.tag.name}${c.group ? " +trip" : ""}` : c.kind === "group" ? `group ${c.group.name}` : `new ${c.name}`))
    .toEqual(["tag SINGAPORE 2026 +trip", "group Subscriptions"])
  expect(tagChoices(data.state.tags, [trip, subs], "dinners").at(-1)).toEqual({ kind: "new", name: "dinners" })
})

test("keys: T opens the chooser; in a review x and esc act on candidates", async () => {
  setup()
  handleKey(ui, key("t", { shift: true }), data)
  expect((ui.state.tagChooser != null)).toBe(true)
  for (const c of "dinners") handleKey(ui, key(c), data)
  expect((ui.state.tagChooser?.query ?? "")).toBe("dinners")
  handleKey(ui, key("escape"), data)
  expect((ui.state.tagChooser != null)).toBe(false)
  const { ai } = fakeJev()
  await data.openTagReview({ tagId: null, name: "Coffee", categoryIds: [], about: null }, ai)
  // No scope: all four coffee rows; x drops the cursor row.
  expect(shown()).toHaveLength(4)
  handleKey(ui, key("x"), data)
  expect(shown()).toHaveLength(3)
  handleKey(ui, key("escape"), data)
  expect(data.state.tagReview).toBeNull()
})
