import { expect, onTestFinished, spyOn, test } from "bun:test"
import type { JevClient, JevQuestion } from "../ai/jev"
import { addDays, appToday } from "../domain/days"
import { testEnv } from "../testing/scoped"
import { data } from "./dataStore"

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
  const summary = await data.askAbout(ai)
  // Old Cafe is outside the last 90 days and $5 fails the amount: neither sent.
  expect(sent.sort()).toEqual(["Alba Coffee", "Bunnings", "Espresso Bar"])
  expect(shown()).toEqual(["Alba Coffee", "Espresso Bar"])
  expect(summary).toBe('ask "coffee": 2 of 3 match')
  expect(data.state.asking).toBeNull()

  // Judged rows aren't sent again; NOT uses the same verdicts.
  sent.length = 0
  data.commitFilter("NOT ask:coffee AND amt:<=-6")
  expect(await data.askAbout(ai)).toBe('ask "coffee": 2 of 3 match')
  expect(sent).toEqual([])
  expect(shown()).toEqual(["Bunnings"])
})

test("a date term widens the window; without one the summary says what was left out", async () => {
  setup()
  const { ai } = fakeJev()
  data.commitFilter("ask:coffee")
  expect(await data.askAbout(ai)).toBe('ask "coffee": 2 of 3 match · judged the last 90 days (add date: to look further)')
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
  expect(await running).toBe("")
  expect(data.state.asking).toBeNull()
  data.commitFilter("ask:coffee")
  await expect(data.askAbout()).rejects.toThrow("JASKMONEY_JEV_TOKEN")
})
