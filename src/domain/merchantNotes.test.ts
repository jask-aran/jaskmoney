import { expect, test } from "bun:test"
import type { JevClient, JevQuestion } from "../ai/jev"
import { category, transaction } from "../testing/fixtures"
import { matchQuestion, merchantBreadthQuestion, suggestionQuestion, tagQuestion } from "./questions"
import { rowFacts } from "./history"
import { askMerchantBreadth, jevSuggestions } from "./suggest"

const note = "varies: phone cases, homewares, gifts"
const row = transaction({ description: " eBay ", rawText: "eBay INTERNET" })

test("merchant notes change only the breadth and category suggestion questions when present", () => {
  const breadth = merchantBreadthQuestion(row.description, row.rawText)
  expect(breadth).toMatchObject({ type: "noul", instructions: { merchant: { name: "eBay", bank_text: "eBay INTERNET" } } })
  expect(JSON.stringify(breadth)).not.toContain("note")
  const withNote = merchantBreadthQuestion(row.description, row.rawText, note)
  expect(withNote).toMatchObject({ type: "noul", instructions: { merchant: { name: "eBay", bank_text: "eBay INTERNET", note } } })
  expect(JSON.stringify(withNote)).not.toBe(JSON.stringify({ ...breadth, instructions: { ...(breadth.instructions as object), merchant: { name: "eBay", bank_text: "eBay INTERNET", note } } }))
  const plain = suggestionQuestion(row, { c1: "Groceries" }, "Groceries ×1")
  expect(plain).toMatchObject({ type: "choice", instructions: { transaction: rowFacts(row, { earlier: "Groceries ×1" }) }, criteria: { c1: "Groceries" } })
  if (typeof plain.instructions !== "object") throw new Error("Expected transaction facts")
  expect(suggestionQuestion(row, { c1: "Groceries" }, "Groceries ×1", note)).toEqual({
    ...plain,
    instructions: {
      ...plain.instructions,
      question: plain.instructions.question + " `transaction.merchant_note` is what the account holder says about this merchant.",
      transaction: { ...rowFacts(row, { earlier: "Groceries ×1" }), merchant_note: note },
    },
  })
  expect(JSON.stringify(plain)).not.toContain("merchant_note")
  expect(JSON.stringify(matchQuestion(row))).not.toContain("merchant_note")
  expect(JSON.stringify(tagQuestion(row, true, true))).not.toContain("merchant_note")
  expect(merchantBreadthQuestion(row.description, row.rawText, "")).toEqual(breadth)
  expect(suggestionQuestion(row, { c1: "Groceries" }, "Groceries ×1", "")).toEqual(plain)
})

test("breadth and suggestion requests look up each merchant's note by its normalised key", async () => {
  const rows = [row, transaction({ id: 2, description: "Cafe" })]
  const notes = new Map([["ebay", note]])
  const breadth: JevQuestion[] = []
  const choices: JevQuestion[] = []
  const ai: Pick<JevClient, "judge"> = { async judge(questions) {
    const out: Awaited<ReturnType<JevClient["judge"]>> = {}
    for (const [id, q] of Object.entries(questions)) {
      if (q.type === "noul") {
        breadth.push(q)
        out[id] = { type: "noul", noul: 0.9 }
      } else {
        choices.push(q)
        out[id] = { type: "choice", choice: "c1", confidence: 0.9, probabilities: { c1: 0.9 } }
      }
    }
    return out
  } }
  await askMerchantBreadth(ai, rows, { notes, onAnswers: () => {} })
  await jevSuggestions(ai, rows, [category({ id: 1, name: "Groceries" })], { notes })
  expect(breadth).toEqual(rows.map((t) => merchantBreadthQuestion(t.description, t.rawText, notes.get(t.description.trim().toLowerCase()))))
  expect(choices).toEqual([
    suggestionQuestion(row, { c1: "Groceries" }, "", note),
    suggestionQuestion(rows[1]!, { c1: "Groceries" }),
  ])
})
