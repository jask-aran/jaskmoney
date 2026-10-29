import { expect, test } from "bun:test"
import { transaction } from "../testing/fixtures"
import { categorisedByMerchant, examplesOf, isPersonToPerson, merchantKey, rankCategories, rowFacts, similarMessages, whenText } from "./history"

test("the row block: one vocabulary; empty facts left out; the rest only where asked for", () => {
  const t = transaction({ id: 1, description: " Amazon ", amount: -54.9, transactionType: "Purchase", rawText: "AMAZON AU RETAIL, SYDNEY", message: null, notes: "", tagNames: [], categoryId: 4, categoryName: "Homeware", dateISO: "2026-10-03", dateRaw: "2026-10-03T14:22:00+10:00", accountName: "Spending", cardMethod: "ECOMMERCE", foreignAmount: null })
  expect(rowFacts(t)).toEqual({ description: "Amazon", amount: "-$54.90", direction: "money out", bank_type: "Purchase", bank_text: "AMAZON AU RETAIL, SYDNEY" })
  expect(rowFacts(t, { category: true, date: true, when: true, account: true, paid: true, earlier: "Homeware ×2", merchantNote: "varies" })).toEqual({
    description: "Amazon", amount: "-$54.90", direction: "money out", bank_type: "Purchase", bank_text: "AMAZON AU RETAIL, SYDNEY",
    category: "Homeware", date: "2026-10-03", when: "Sat 3 Oct 2026, 14:22", account: "Spending", paid: "online", categorised_before: "Homeware ×2", merchant_note: "varies",
  })
  // Your own note, tags (not IGNORE), a message and a foreign amount whenever there are any.
  expect(rowFacts(transaction({ amount: 23, notes: " for Sam ", tagNames: ["TRAVEL", "IGNORE"], message: "dinner", foreignAmount: "SGD 25.90" }))).toMatchObject({ direction: "money in", your_note: "for Sam", tags: "TRAVEL", message: "dinner", foreign_amount: "SGD 25.90" })
  expect(rowFacts(transaction({ tagNames: ["IGNORE"] }))).not.toHaveProperty("tags")
  // No real category, no category; raw text the same as the description isn't repeated.
  expect(rowFacts(transaction({ categoryId: null, categoryName: "Uncategorised" }), { category: true })).not.toHaveProperty("category")
  expect(rowFacts(transaction({ description: "Beem", rawText: "Beem" }))).not.toHaveProperty("bank_text")
  expect(whenText({ dateISO: "2026-10-03", dateRaw: "03/10/2026" })).toBe("Sat 3 Oct 2026")
})

test("people and payment apps; a merchant's key ignores case and outer spaces", () => {
  expect(isPersonToPerson({ transactionType: "Osko Payment Received" })).toBe(true)
  expect(isPersonToPerson({ transactionType: "Purchase" })).toBe(false)
  expect(isPersonToPerson({ transactionType: null })).toBe(false)
  expect(merchantKey("  Coles ")).toBe(merchantKey("coles"))
})

test("categorised history: by merchant, only assignable categories; ranked by count, then the most recent", () => {
  const row = (id: number, description: string, categoryId: number | null, dateISO = "2026-01-01") => transaction({ id, description, categoryId, categoryName: categoryId ? `C${categoryId}` : "Uncategorised", dateISO })
  const rows = [row(1, "Coles", 1), row(2, " coles", 2, "2026-02-01"), row(3, "Coles", 1, "2026-01-05"), row(4, "Coles", null), row(5, "Coles", 9), row(6, "Aldi", 2)]
  const byMerchant = categorisedByMerchant(rows, new Set([1, 2]))
  expect([...byMerchant.keys()]).toEqual(["coles", "aldi"])
  expect(byMerchant.get("coles")!.map((t) => t.id)).toEqual([1, 2, 3])
  expect(rankCategories(byMerchant.get("coles")!).map((c) => [c.categoryId, c.count, c.latest.id])).toEqual([[1, 2, 3], [2, 1, 2]])
  // A tie goes to the category used most recently.
  expect(rankCategories([row(7, "X", 1, "2026-01-01"), row(8, "X", 2, "2026-03-01")]).map((c) => c.categoryId)).toEqual([2, 1])
})

test("the examples block: one per description, most rows first, then the most recent; long ones cut", () => {
  const row = (id: number, description: string, dateISO = "2026-01-01") => transaction({ id, description, dateISO })
  const rows = [row(1, "Coles"), row(2, " coles "), row(3, "Aldi", "2026-03-01"), row(4, "IGA", "2026-02-01"), row(5, "A very long merchant description that goes on and on")]
  expect(examplesOf(rows, 3)).toEqual(["Coles", "Aldi", "IGA"])
  expect(examplesOf(rows, 9).at(-1)).toBe("A very long merchant description that g…")
  expect(examplesOf([], 3)).toEqual([])
})

test("similar messages: your categorised rows sharing its rarer words, most alike first; a common word alone doesn't count", () => {
  const paid = (id: number, message: string, categoryName: string, amount = 20, dateISO = "2026-09-01") =>
    transaction({ id, description: `Friend ${id}`, transactionType: "Payment Received", message, amount, categoryId: 1, categoryName, dateISO })
  // "jask" is in most messages: on its own it says nothing.
  const history = [
    paid(1, "sams gift jask", "Gifts & Charity", 30, "2026-08-05"),
    paid(2, "pho jask", "Restaurants & Cafes"),
    paid(3, "ramen jask", "Restaurants & Cafes"),
    paid(4, "rent jask", "Rent & Mortgage"),
    paid(5, "uber jask", "Taxis & Share Cars"),
    paid(6, "Bright accom", "Holidays & Travel"),
    paid(7, "power bill", "Utilities"),
    transaction({ id: 8, description: "Friend 8", message: "gift wrap", categoryId: null, categoryName: "Uncategorised" }),
  ]
  const similar = similarMessages(history)
  expect(similar(paid(10, "Sam gift bday", "Uncategorised"))).toEqual(['"sams gift jask" (money in, $30.00) → Gifts & Charity'])
  expect(similar(paid(11, "jask", "Uncategorised"))).toEqual([])
  expect(similar(transaction({ id: 12, description: "Coles", message: null }))).toEqual([])
  const facts = rowFacts(paid(10, "Sam gift bday", "Uncategorised"), { similar: similar(paid(10, "Sam gift bday", "Uncategorised")) })
  expect(facts.similar_messages).toBe('"sams gift jask" (money in, $30.00) → Gifts & Charity')
})
