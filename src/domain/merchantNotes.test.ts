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
  expect(JSON.stringify(breadth)).toBe(JSON.stringify({
    type: "noul",
    instructions: {
      question: "Does `merchant` sell a wide range of unrelated goods (such as electronics, homewares, clothing and toys), so a purchase there could be any of them?",
      merchant: { name: "eBay", bank_text: "eBay INTERNET" },
    },
    criteria: {
      true: "A marketplace or a store selling many unrelated kinds of goods",
      false: "A shop for one kind of thing, including a supermarket (groceries), a cafe, a petrol station or a service",
    },
  }))
  expect(merchantBreadthQuestion(row.description, row.rawText, note)).toEqual({
    type: "noul",
    instructions: {
      question: "Going by `merchant.note`, would the account holder's purchases at `merchant` fall into different budget categories from one time to the next?",
      merchant: { name: "eBay", bank_text: "eBay INTERNET", note },
    },
    criteria: {
      true: "Different purchases there are different kinds of spending: electronics one time, clothes or a gift the next",
      false: "Their purchases there are nearly always one kind of spending, such as groceries",
    },
  })
  const plain = suggestionQuestion(row, { c1: "Groceries" }, "Groceries ×1")
  expect(JSON.stringify(plain)).toBe(JSON.stringify({
    type: "choice",
    instructions: {
      question: "Which category does `transaction` belong in? The description may be a person's name or a payment app rather than a shop: then the message, if any, says what the money was for, and the description says nothing about the category.",
      transaction: { description: "eBay", amount: "-$10.00", direction: "money out", bank_text: "eBay INTERNET", categorised_before: "Groceries ×1" },
    },
    criteria: { c1: "Groceries" },
  }))
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
