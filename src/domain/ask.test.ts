import { describe, expect, test } from "bun:test"
import type { JevQuestion } from "../ai/jev"
import { judgeRows } from "./ask"
import { evalFilter, parseFilterStrict, type AskVerdict, type FilterTxn } from "./filter"
import { transaction } from "../testing/fixtures"

const row = (description: string, amount = -10): FilterTxn & { id: number } => ({
  id: description.length, description, amount, categoryId: null, categoryName: "", accountName: "A", notes: "", dateISO: "2026-10-01", tagNames: [],
})
const parse = (s: string) => { const r = parseFilterStrict(s); expect(r.error).toBeUndefined(); return r.node }

describe("ask: in the filter", () => {
  test("rows pass on Clef's verdicts; unjudged rows wait (hidden)", () => {
    const verdicts = new Map([["Cafe", true], ["Bunnings", false]])
    const ask: AskVerdict<FilterTxn> = (words, t) => words === "coffee" ? verdicts.get(t.description) : undefined
    const node = parse("ask:coffee")
    expect(["Cafe", "Bunnings", "Unjudged"].filter((d) => evalFilter(node, row(d), ask))).toEqual(["Cafe"])
    expect(["Cafe", "Bunnings", "Unjudged"].filter((d) => evalFilter(parse("NOT ask:coffee"), row(d), ask))).toEqual(["Bunnings"])
  })
})

describe("asking Clef", () => {
  test("each row is its own question, the transaction inline with its category; the words are the state; Jev's probability comes back", async () => {
    const rows = [transaction({ id: 1, description: "Alba Coffee", categoryId: 4, categoryName: "Restaurants & Cafes" }), transaction({ id: 2, description: "Bunnings" }), transaction({ id: 3, description: "Maybe" })]
    const sent: { qs: Record<string, JevQuestion>; state: unknown }[] = []
    const jev = { async judge(qs: Record<string, JevQuestion>, state: unknown) {
      sent.push({ qs, state })
      const p = (q: JevQuestion) => { const d = (q.instructions as { transaction: { description: string } }).transaction.description; return d === "Alba Coffee" ? 0.9 : d === "Maybe" ? 0.6 : 0.1 }
      return Object.fromEntries(Object.entries(qs).map(([id, q]) => [id, { type: "noul" as const, noul: p(q) }]))
    } }
    const scores = new Map<number, number>()
    await judgeRows(jev, "coffee", rows, { onJudged: (v) => v.forEach((p, id) => scores.set(id, p)) })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.state).toEqual({ search: "coffee" })
    expect(Object.values(sent[0]!.qs)[0]).toMatchObject({ type: "noul", instructions: { transaction: { description: "Alba Coffee", category: "Restaurants & Cafes" } } })
    expect([...scores]).toEqual([[1, 0.9], [2, 0.1], [3, 0.6]])
  })
})
