import { expect, onTestFinished, spyOn, test } from "bun:test"
import type { JevClient, JevQuestion } from "../ai/jev"
import { addDays, appToday } from "../domain/days"
import { testEnv } from "../testing/scoped"
import { data, showNearMisses } from "./dataStore"
import type { AskResult } from "../client/store"

/** The one ask term's counts from a run. */
const term = async (run: Promise<AskResult | null>) => (await run)!.terms[0]!

function setup() {
  testEnv("JASKMONEY_JEV_TOKEN", "")
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => { throw new Error("network is forbidden") }, { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => {
    try { expect(network).not.toHaveBeenCalled() } finally { network.mockRestore() }
  })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  const add = (id: number, description: string, amount: number, daysAgo = 1) =>
    db.query(`INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (?, ?, ?, ?, ?, 100, 'csv')`)
      .run(id, "x", addDays(appToday(), -daysAgo), amount, description)
  add(1, "Alba Coffee", -6)
  add(2, "Bunnings", -40)
  add(3, "Espresso Bar", -25)
  add(4, "Old Cafe", -5, 200)
  data.refresh()
  data.setState({ accountSelection: "all" })
  onTestFinished(() => { data.clearFilter(); data.init(":memory:") })
}

/** A fake Jev: coffee is anything with Coffee, Espresso or Cafe in it. Records what it was sent. */
function fakeJev() {
  const sent: string[] = []
  const description = (q: JevQuestion) => (q.instructions as { transaction: { description: string } }).transaction.description
  const ai: Pick<JevClient, "judge"> = { async judge(questions) {
    sent.push(...Object.values(questions).map(description))
    return Object.fromEntries(Object.entries(questions).map(([id, q]) => [id, { type: "noul" as const, noul: /coffee|espresso|cafe/i.test(description(q)) ? 0.9 : 0.1 }]))
  } }
  return { ai, sent }
}
const shown = () => data.scopedTransactions().map((t) => t.description).sort()

test("ask: shows nothing until judged, then the matches; sends only rows the rest of the filter allows, from the window", async () => {
  setup()
  const { ai, sent } = fakeJev()
  data.commitFilter("ask:coffee AND amt:<=-6")
  expect(shown()).toEqual([])
  const summary = await term(data.askAbout(ai))
  // Old Cafe is outside the last 90 days and $5 fails the amount: neither sent.
  expect(sent.sort()).toEqual(["Alba Coffee", "Bunnings", "Espresso Bar"])
  expect(shown()).toEqual(["Alba Coffee", "Espresso Bar"])
  expect(summary).toMatchObject({ rows: 3, asked: 3, matched: 2 })
  expect(data.state.asking).toBeNull()

  // Judged rows aren't sent again; NOT uses the same verdicts.
  sent.length = 0
  data.commitFilter("NOT ask:coffee AND amt:<=-6")
  expect(await term(data.askAbout(ai))).toMatchObject({ rows: 3, asked: 0, matched: 2 })
  expect(sent).toEqual([])
  expect(shown()).toEqual(["Bunnings"])
})

test("a date term widens the window; without one the summary says what was left out", async () => {
  setup()
  const { ai } = fakeJev()
  data.commitFilter("ask:coffee")
  const run = (await data.askAbout(ai))!
  expect(run.dated).toBe(false)
  expect(run.terms[0]).toMatchObject({ rows: 3, matched: 2, skipped: 1 })
  data.commitFilter(`ask:coffee AND date:${addDays(appToday(), -365)}..${appToday()}`)
  await data.askAbout(ai)
  expect(shown()).toEqual(["Alba Coffee", "Espresso Bar", "Old Cafe"])
})

test("clearing the filter stops a run; no Jev is an error, not an empty result", async () => {
  setup()
  let release = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const ai: Pick<JevClient, "judge"> = { async judge() { await gate; return {} } }
  data.commitFilter("ask:coffee")
  const running = data.askAbout(ai)
  expect(data.state.asking).toMatchObject({ words: "coffee", judged: 0, total: 3 })
  data.clearFilter()
  release()
  expect(await running).toBeNull()
  expect(data.state.asking).toBeNull()
  data.commitFilter("ask:coffee")
  await expect(data.askAbout()).rejects.toThrow("ask: needs Jev")
})

test("session reset discards cached ASK verdicts and stops a pending run", async () => {
  setup()
  const { ai } = fakeJev()
  data.commitFilter("ask:coffee")
  await data.askAbout(ai)
  expect(shown()).toEqual(["Alba Coffee", "Espresso Bar"])
  const accounts = [...data.state.accounts]
  const transactions = [...data.state.transactions]
  data.reset()
  data.setState({ accounts, transactions })
  data.commitFilter("ask:coffee")
  expect(shown()).toEqual([])

  let release = () => {}
  const gate = new Promise<void>((resolve) => { release = resolve })
  const pending: Pick<JevClient, "judge"> = { async judge(questions, state) {
    await gate
    return ai.judge(questions, state)
  } }
  const running = data.askAbout(pending)
  expect(data.state.asking).not.toBeNull()
  data.reset()
  data.setState({ accounts, transactions })
  data.commitFilter("ask:coffee")
  release()
  expect(await running).toBeNull()
  expect(data.state.asking).toBeNull()
  expect(shown()).toEqual([])
})

test("near misses (Jev 30–70%) show after the matches when they don't swamp them; n hides or shows them; clearing the filter goes back to automatic", async () => {
  setup()
  const db = data.getDb()!
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (5, 'x', ?, -9, 'Tea House', 100, 'csv')").run(addDays(appToday(), -1))
  data.refresh()
  const ai: Pick<JevClient, "judge"> = { async judge(questions) {
    return Object.fromEntries(Object.entries(questions).map(([id, q]) => {
      const d = (q.instructions as { transaction: { description: string } }).transaction.description
      return [id, { type: "noul" as const, noul: /coffee|espresso/i.test(d) ? 0.9 : /tea/i.test(d) ? 0.5 : 0.1 }]
    }))
  } }
  data.commitFilter("ask:coffee")
  expect(await term(data.askAbout(ai))).toMatchObject({ rows: 4, matched: 2, near: 1 })
  expect(data.askCounts()).toEqual({ matches: 2, near: 1 })
  // One near miss beside two matches: shown, last, and marked as one.
  expect(data.nearMissesShown()).toBe(true)
  expect(data.scopedTransactions().map((t) => t.description).at(-1)).toBe("Tea House")
  expect([...data.nearMissIds()]).toEqual([5])
  expect(data.askScore(5)).toBe(0.5)
  expect(data.askScore(1)).toBe(0.9)
  data.setAskLoose(false)
  expect(shown()).toEqual(["Alba Coffee", "Espresso Bar"])
  expect(data.nearMissIds().size).toBe(0)
  data.clearFilter()
  expect(data.state.askLoose).toBeNull()
})

test("near misses show by themselves unless they outnumber the matches (a handful always do)", () => {
  expect(showNearMisses(24, 5)).toBe(true)
  expect(showNearMisses(0, 3)).toBe(true)
  expect(showNearMisses(0, 6)).toBe(false)
  expect(showNearMisses(5, 40)).toBe(false)
  expect(showNearMisses(10, 10)).toBe(true)
})

test("rows a covered category already matches aren't sent to Jev; it reads only the rest", async () => {
  setup()
  const db = data.getDb()!
  db.query("INSERT INTO categories (id, name, color) VALUES (200, 'Hardware', '#fff')").run()
  db.query("UPDATE transactions SET category_id = 200 WHERE id = 2").run()
  data.refresh()
  const { ai, sent } = fakeJev()
  data.commitFilter("(cat:Hardware OR ask:coffee) AND amt:<=-6")
  // Bunnings matches by its category before Jev says anything.
  expect(shown()).toEqual(["Bunnings"])
  expect(await term(data.askAbout(ai))).toMatchObject({ rows: 2, matched: 2 })
  expect(sent.sort()).toEqual(["Alba Coffee", "Espresso Bar"])
  expect(shown()).toEqual(["Alba Coffee", "Bunnings", "Espresso Bar"])
})

test("top: cuts the matches; near misses follow them, cut alike, never in their place", async () => {
  setup()
  const db = data.getDb()!
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (5, 'x', ?, -90, 'Tea House', 100, 'csv'), (6, 'x', ?, -80, 'Tea Bar', 100, 'csv')").run(addDays(appToday(), -1), addDays(appToday(), -2))
  data.refresh()
  const ai: Pick<JevClient, "judge"> = { async judge(questions) {
    return Object.fromEntries(Object.entries(questions).map(([id, q]) => {
      const d = (q.instructions as { transaction: { description: string } }).transaction.description
      return [id, { type: "noul" as const, noul: /coffee|espresso/i.test(d) ? 0.9 : /tea/i.test(d) ? 0.5 : 0.1 }]
    }))
  } }
  data.commitFilter("ask:coffee top:1")
  await data.askAbout(ai)
  data.setAskLoose(true)
  const rows = data.scopedTransactions()
  // The one biggest match, then the one biggest near miss (the $90 tea, though it's bigger).
  expect(rows.map((t) => t.description)).toEqual([rows[0]!.description, "Tea House"])
  expect(rows[0]!.description).toMatch(/coffee|espresso/i)
  data.setAskLoose(false)
  expect(data.scopedTransactions()).toHaveLength(1)
})
