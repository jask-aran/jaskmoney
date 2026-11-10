import { expect, onTestFinished, spyOn, test } from "bun:test"
import type { JevClient, JevQuestion } from "../ai/jev"
import { addDays, appToday } from "../domain/days"
import { testEnv } from "../testing/scoped"
import { data } from "./dataStore"
import type { AskResult } from "../client/store"

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
  expect(sent.sort()).toEqual(["Alba Coffee", "Bunnings", "Espresso Bar"])
  expect(shown()).toEqual(["Alba Coffee", "Espresso Bar"])
  expect(summary).toMatchObject({ rows: 3, asked: 3, matched: 2 })
  expect(data.state.asking).toBeNull()

  sent.length = 0
  data.commitFilter("NOT ask:coffee AND amt:<=-6")
  expect(await term(data.askAbout(ai))).toMatchObject({ rows: 3, asked: 0, matched: 2 })
  expect(sent).toEqual([])
  expect(shown()).toEqual(["Bunnings"])
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
