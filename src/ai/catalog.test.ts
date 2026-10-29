import { expect, onTestFinished, spyOn, test } from "bun:test"
import { previewSent, type SentPart } from "../app/sentPreview"
import { data } from "../state/dataStore"
import { testEnv } from "../testing/scoped"
import { AI_USES, BLOCKS, QUERIES, USES, useQueries, type QueryId } from "./catalog"

/** Rows that give every block something to say: a waiting row whose
 * merchant has history and a note, and a tag with categories, an About
 * and a tagged row. Nothing may reach the network. */
function setup() {
  testEnv("JASKMONEY_JEV_TOKEN", "")
  const network = spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => { throw new Error("network is forbidden") }, { preconnect: globalThis.fetch.preconnect }))
  onTestFinished(() => { try { expect(network).not.toHaveBeenCalled() } finally { network.mockRestore(); data.init(":memory:") } })
  data.init(":memory:")
  const db = data.getDb()!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO categories (id, name, color) VALUES (100, 'Test food', '#fff'), (101, 'Test fun', '#fff')").run()
  const row = db.query(`INSERT INTO transactions (id, date_raw, date_iso, amount, description, category_id, account_id, source, transaction_type, raw_text)
    VALUES (?, ?, ?, ?, ?, ?, 100, 'csv', 'Purchase', ?)`)
  row.run(1, "2026-10-01", "2026-10-01", -5, "Bulk Barn", 100, "BULK BARN PTY")
  row.run(2, "2026-10-02", "2026-10-02", -6, "Bulk Barn", 100, "BULK BARN PTY")
  row.run(3, "2026-10-20", "2026-10-20", -7, "Bulk Barn", null, "BULK BARN PTY")
  row.run(4, "2026-10-03", "2026-10-03", -12, "Corner Bar", 101, "CORNER BAR")
  row.run(5, "2026-10-10", "2026-10-10", -20, "Night Owl", 101, "NIGHT OWL")
  db.query("INSERT INTO merchant_notes (merchant, note) VALUES ('bulk barn', 'bulk dry foods')").run()
  db.query("INSERT INTO tags (id, name, about) VALUES (50, 'NIGHTS', 'nights out')").run()
  db.query("INSERT INTO tag_categories (tag_id, category_id) VALUES (50, 101)").run()
  db.query("INSERT INTO transaction_tags (transaction_id, tag_id) VALUES (4, 50)").run()
  data.refresh()
}

/** Every key anywhere in `value`. */
function keys(value: unknown, out = new Set<string>()): Set<string> {
  if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) { out.add(k); keys(v, out) }
  return out
}
const object = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {})

/** The keys a request carries as context: a Jev request's state and each
 * question's instructions (and the transaction's own facts); otherwise
 * the body's top level, less the model and the questions. */
function contextKeys(body: unknown): { top: string[]; transaction: string[] } {
  const b = object(body)
  if ("questions" in b) {
    const questions = Object.values(object(b.questions)).map(object)
    const top = [...Object.keys(object(b.state)), ...questions.flatMap((q) => Object.keys(object(q.instructions)).filter((k) => k !== "question"))]
    return { top: [...new Set(top)], transaction: [...new Set(questions.flatMap((q) => Object.keys(object(object(q.instructions).transaction))))] }
  }
  return { top: Object.keys(b).filter((k) => !["model", "fields"].includes(k)), transaction: [] }
}

/** What the row block itself says (history.rowFacts). */
const ROW = ["description", "amount", "direction", "bank_type", "message", "bank_text", "your_note", "tags", "foreign_amount", "category", "date", "when", "account", "paid"]

test("every query a use names is in the catalog; every query and block is named by something", () => {
  const named: string[] = AI_USES.flatMap(useQueries)
  expect(new Set(named)).toEqual(new Set(Object.keys(QUERIES)))
  for (const id of AI_USES.flatMap(useQueries)) expect(USES[QUERIES[id].use].features.some((f) => f.queries.includes(id))).toBe(true)
  const used = new Set<string>(Object.values(QUERIES).flatMap((q) => q.context.map((c) => c.block)))
  expect(used).toEqual(new Set(Object.keys(BLOCKS)))
})

test("each query's real request carries exactly the context the catalog says, in the fields it names", async () => {
  setup()
  const parts = new Map<QueryId, SentPart>()
  for (const use of AI_USES) for (const part of await previewSent(use, data, { clairic: true, smartQuestion: "bulk barn last month" })) parts.set(part.query, part)
  expect([...parts.keys()].sort() as string[]).toEqual(Object.keys(QUERIES).sort())
  for (const [id, part] of parts) {
    const sent = contextKeys(part.body)
    const all = keys(part.body)
    const declared = QUERIES[id].context.filter((c) => c.via !== "tools").flatMap((c) => c.fields)
    // Everything declared is sent…
    for (const field of declared) expect({ id, field, sent: all.has(field) }).toEqual({ id, field, sent: true })
    // …and nothing is sent that isn't declared.
    for (const key of sent.top) expect({ id, key, declared: declared.includes(key) }).toEqual({ id, key, declared: true })
    for (const key of sent.transaction) expect({ id, key, declared: ROW.includes(key) || declared.includes(key) }).toEqual({ id, key, declared: true })
  }
})
