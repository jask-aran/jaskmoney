import { describe, expect, test } from "bun:test"
import type { JevQuestion } from "../ai/jev"
import { askCandidates, ASK_LIMIT, judgeRows } from "./ask"
import { MATCH_AT } from "./questions"
import { askTerms, evalFilter, filterExprString, hasDateTerm, mightMatch, parseFilterStrict, type AskVerdict, type FilterTxn } from "./filter"
import { transaction } from "../testing/fixtures"

const row = (description: string, amount = -10): FilterTxn & { id: number } => ({
  id: description.length, description, amount, categoryId: null, categoryName: "", accountName: "A", notes: "", dateISO: "2026-10-01", tagNames: [],
})
const parse = (s: string) => { const r = parseFilterStrict(s); expect(r.error).toBeUndefined(); return r.node }

describe("ask: in the filter", () => {
  test("parses, prints and lists its words; a rule-style evaluation (no verdicts) passes nothing", () => {
    const node = parse('ask:"eating out" AND amt:<=-20')
    expect(filterExprString(node)).toBe('ask:"eating out" AND amt:<=-20')
    expect(askTerms(parse('ask:coffee OR (ask:"eating out" AND NOT ask:coffee)'))).toEqual(["coffee", "eating out"])
    expect(evalFilter(parse("ask:coffee"), row("Cafe"))).toBe(false)
    expect(hasDateTerm(node)).toBe(false)
    expect(hasDateTerm(parse("ask:coffee AND (date:2026-01 OR amt:>5)"))).toBe(true)
  })

  test("rows pass on Clef's verdicts; unjudged rows wait (hidden)", () => {
    const verdicts = new Map([["Cafe", true], ["Bunnings", false]])
    const ask: AskVerdict<FilterTxn> = (words, t) => words === "coffee" ? verdicts.get(t.description) : undefined
    const node = parse("ask:coffee")
    expect(["Cafe", "Bunnings", "Unjudged"].filter((d) => evalFilter(node, row(d), ask))).toEqual(["Cafe"])
    expect(["Cafe", "Bunnings", "Unjudged"].filter((d) => evalFilter(parse("NOT ask:coffee"), row(d), ask))).toEqual(["Bunnings"])
  })

  test("only rows a verdict could still let through are worth asking about, under AND, OR and NOT", () => {
    const unknown: AskVerdict<FilterTxn> = () => undefined
    const might = (expr: string, t: FilterTxn) => mightMatch(parse(expr), t, unknown)
    expect(might("ask:coffee AND amt:<=-20", row("x", -10))).toBe(false)
    expect(might("ask:coffee AND amt:<=-20", row("x", -30))).toBe(true)
    expect(might("NOT ask:coffee AND amt:<=-20", row("x", -30))).toBe(true)
    // Already passes without Clef: no need to ask.
    expect(might('desc:x OR ask:coffee', row("x"))).toBe(true)
    expect(might('desc:y OR ask:coffee', row("x"))).toBe(true)
    const judged: AskVerdict<FilterTxn> = () => false
    expect(mightMatch(parse("ask:coffee"), row("x"), judged)).toBe(false)
  })
})

describe("asking Clef", () => {
  test("the window: newest first, last 90 days unless the filter has dates, at most ASK_LIMIT", () => {
    const rows = [transaction({ id: 1, dateISO: "2026-10-20" }), transaction({ id: 2, dateISO: "2026-07-30" }), transaction({ id: 3, dateISO: "2026-07-29" }), transaction({ id: 4, dateISO: "2025-01-01" })]
    expect(askCandidates(rows, "2026-10-27", false)).toEqual({ rows: [rows[0], rows[1]], skipped: 2 })
    expect(askCandidates(rows, "2026-10-27", true).rows.map((t) => t.id)).toEqual([1, 2, 3, 4])
    const many = Array.from({ length: ASK_LIMIT + 3 }, (_, i) => transaction({ id: i + 1, dateISO: "2026-10-01" }))
    expect(askCandidates(many, "2026-10-27", true)).toMatchObject({ skipped: 3 })
    expect(askCandidates(many, "2026-10-27", true).rows[0]!.id).toBe(ASK_LIMIT + 3)
  })

  test("each row is its own question, the transaction inline with its category; the words are the state; a match is 0.7 or more", async () => {
    const rows = [transaction({ id: 1, description: "Alba Coffee", categoryId: 4, categoryName: "Restaurants & Cafes" }), transaction({ id: 2, description: "Bunnings" }), transaction({ id: 3, description: "Maybe" })]
    const sent: { qs: Record<string, JevQuestion>; state: unknown }[] = []
    const jev = { async judge(qs: Record<string, JevQuestion>, state: unknown) {
      sent.push({ qs, state })
      const p = (q: JevQuestion) => { const d = (q.instructions as { transaction: { description: string } }).transaction.description; return d === "Alba Coffee" ? 0.9 : d === "Maybe" ? 0.6 : 0.1 }
      return Object.fromEntries(Object.entries(qs).map(([id, q]) => [id, { type: "noul" as const, noul: p(q) }]))
    } }
    const verdicts = new Map<number, boolean>()
    await judgeRows(jev, "coffee", rows, { onJudged: (v) => v.forEach((m, id) => verdicts.set(id, m)) })
    expect(sent).toHaveLength(1)
    expect(sent[0]!.state).toEqual({ search: "coffee" })
    expect(Object.values(sent[0]!.qs)[0]).toMatchObject({ type: "noul", instructions: { transaction: { description: "Alba Coffee", category: "Restaurants & Cafes" } } })
    expect([...verdicts]).toEqual([[1, true], [2, false], [3, false]])
    expect(MATCH_AT).toBe(0.7)
  })

  test("a failed request is reported and the rest carry on", async () => {
    const rows = Array.from({ length: 3 }, (_, i) => transaction({ id: i + 1 }))
    const errors: unknown[] = []
    await judgeRows({ judge: async () => { throw new Error("fake outage") } }, "coffee", rows, { onError: (e) => errors.push(e) })
    expect(errors).toHaveLength(1)
  })
})
