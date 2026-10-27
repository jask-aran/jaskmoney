import { describe, expect, test } from "bun:test"
import type { WorkersAiClient } from "../ai/workersAi"
import { askCandidates, askLine, ASK_BATCH, ASK_LIMIT, judgeRows } from "./ask"
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

  test("a row reads as its description, signed amount, type, message, category and date", () => {
    expect(askLine(transaction({ description: "Corner Bar", amount: -120, transactionType: "Payment", message: "Kestrel ram", categoryName: "Uncategorised", dateISO: "2026-09-06" })))
      .toBe('Corner Bar; -$120.00; Payment; message "Kestrel ram"; category Uncategorised; 2026-09-06')
  })

  test("rows go in batches, each row its own question; a failed batch is reported and the rest land", async () => {
    const rows = Array.from({ length: ASK_BATCH * 2 + 1 }, (_, i) => transaction({ id: i + 1, description: i % 2 ? "Cafe" : "Shop" }))
    const sizes: number[] = []
    let calls = 0
    const ai: Pick<WorkersAiClient, "clef"> = { async clef(questions, state, model) {
      expect(model).toBe("clef-flash")
      if (++calls === 2) throw new Error("fake outage")
      sizes.push(Object.keys(questions).length)
      const lines = state.split("\n")
      expect(questions.t1).toMatchObject({ type: "noul", instructions: expect.stringContaining('"coffee"') })
      return Object.fromEntries(lines.map((l, i) => [`t${i + 1}`, { type: "noul" as const, noul: l.includes("Cafe") ? 0.9 : 0.1 }]))
    } }
    const verdicts = new Map<number, boolean>()
    const errors: unknown[] = []
    await judgeRows(ai, "coffee", rows, { onJudged: (v) => v.forEach((m, id) => verdicts.set(id, m)), onError: (e) => errors.push(e) })
    expect(calls).toBe(3)
    expect(errors).toHaveLength(1)
    // Every row of the batches that answered has a verdict; the failed batch's rows have none.
    expect(sizes).toHaveLength(2)
    expect(verdicts.size).toBe(sizes.reduce((a, b) => a + b, 0))
    expect([...verdicts].filter(([, m]) => m).every(([id]) => rows.find((t) => t.id === id)!.description === "Cafe")).toBe(true)
  })
})
