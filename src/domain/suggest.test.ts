import { expect, test } from "bun:test"
import type { WorkersAiClient } from "../ai/workersAi"
import { category, transaction } from "../testing/fixtures"
import { clefQuestion, clefState, clefSuggestions, historySuggestions } from "./suggest"

const categories = [category({ id: 1 }), category({ id: 2 }), category({ id: 3, isDefault: true, name: "Uncategorised" })]
const evidence = (id: number, categoryId: number, amount = -10, dateISO = "2026-01-01") => transaction({ id, categoryId, categoryName: `Category ${categoryId}`, description: " SHOP ", amount, dateISO })
const target = (id = 10) => transaction({ id, description: "shop" })

test("history settles a merchant only with three or more earlier rows nearly all in one category; small samples are less sure", () => {
  const three = [evidence(1, 1), evidence(2, 1), evidence(3, 1)]
  expect(historySuggestions([target(), ...three], categories)).toEqual([{ transactionId: 10, categoryId: 1, confidence: 3 / 4, source: "history" }])
  expect(historySuggestions([target(), ...three.slice(0, 2)], categories)).toEqual([])
  // 3 of 4 is not nearly all: Clef decides, with the history as context.
  expect(historySuggestions([target(), ...three, evidence(4, 2)], categories)).toEqual([])
  const ten = Array.from({ length: 10 }, (_, i) => evidence(i + 20, 1))
  expect(historySuggestions([target(), ...ten], categories)[0]?.confidence).toBe(10 / 11)
})

test("history prefers the same sign and falls back to either sign", () => {
  const out = [evidence(1, 1), evidence(2, 1), evidence(3, 1)], into = [evidence(4, 2, 10), evidence(5, 2, 10), evidence(6, 2, 10)]
  expect(historySuggestions([target(), ...out, ...into], categories)[0]?.categoryId).toBe(1)
  expect(historySuggestions([target(), ...into], categories)[0]?.categoryId).toBe(2)
})

test("history leaves person-to-person payments and rows with a message to Clef", () => {
  const three = [evidence(1, 1), evidence(2, 1), evidence(3, 1)]
  expect(historySuggestions([transaction({ id: 10, description: "shop", transactionType: "Payment" }), ...three], categories)).toEqual([])
  expect(historySuggestions([transaction({ id: 10, description: "shop", transactionType: "EFTPOS Withdrawal" }), ...three], categories)).toEqual([])
  expect(historySuggestions([transaction({ id: 10, description: "shop", message: "Kestrel ram" }), ...three], categories)).toEqual([])
  expect(historySuggestions([transaction({ id: 10, description: "shop", transactionType: "Purchase" }), ...three], categories)).toHaveLength(1)
})

test("history excludes groups and uncategorised evidence and limits eligible targets", () => {
  const tree = [...categories, category({ id: 4, parentId: 1 })]
  expect(historySuggestions([target(), evidence(1, 1), evidence(2, 3), evidence(3, 999), evidence(4, 1), evidence(5, 3)], tree)).toEqual([])
  const rows = [target(), target(11), evidence(1, 2), evidence(2, 2), evidence(3, 2), transaction({ id: 12, description: "shop", excluded: true }), transaction({ id: 13, description: "shop", tagNames: ["ignore"] })]
  expect(historySuggestions(rows, tree).map((s) => s.transactionId)).toEqual([10, 11])
  expect(historySuggestions(rows, tree, new Set([11])).map((s) => s.transactionId)).toEqual([11])
  expect(historySuggestions(rows, tree, new Set())).toEqual([])
  expect(historySuggestions([transaction({ description: "unknown" })], tree)).toEqual([])
})

test("Clef question uses assignable keys, category paths and money notes", () => {
  expect(clefQuestion([
    category({ id: 1, name: "Good Life" }), category({ id: 18, parentId: 1, name: "Holidays & Travel" }),
    category({ id: 2, name: "Income", income: true }), category({ id: 19, parentId: 2, name: "Salary" }),
    category({ id: 20, name: "Transfers", notSpending: true }), category({ id: 21, name: "Bonus", income: true }),
    category({ id: 3, name: "Uncategorised", isDefault: true }),
  ])).toMatchObject({ type: "choice", criteria: {
    c18: "Good Life › Holidays & Travel", c19: "Income › Salary (income)", c20: "Transfers (not spending: moving your own money)", c21: "Bonus (income)",
  } })
})

test("Clef state supplies signed money, type, date and account", () => {
  expect(clefState(transaction({ description: "SAM PARKER", amount: 882, transactionType: "Osko Payment Received", dateISO: "2026-02-03", accountName: "Spending" })))
    .toBe("Description: SAM PARKER\nAmount: +$882.00 (money in)\nType: Osko Payment Received\nDate: 2026-02-03\nAccount: Spending")
  expect(clefState(transaction({ amount: -12.5 }))).toBe("Description: x\nAmount: -$12.50 (money out)\nDate: 2026-10-05\nAccount: A")
})

test("Clef state carries the message, the bank's own text when it differs, and earlier categories", () => {
  expect(clefState(transaction({ description: "Corner Bar", amount: -120, transactionType: "Payment", message: "Kestrel ram" })))
    .toBe("Description: Corner Bar\nAmount: -$120.00 (money out)\nType: Payment\nMessage: Kestrel ram\nDate: 2026-10-05\nAccount: A")
  expect(clefState(transaction({ description: "$friend_a", rawText: "Deniz Turkyilmaz" }), "Holidays & Travel ×2, Other income ×1"))
    .toBe("Description: $friend_a\nAmount: -$10.00 (money out)\nBank text: Deniz Turkyilmaz\nDate: 2026-10-05\nAccount: A\nEarlier with this description: Holidays & Travel ×2, Other income ×1")
  expect(clefState(transaction({ description: "Beem", rawText: "Beem" }))).not.toContain("Bank text")
})

test("Clef is told how rows with the same description were categorised", async () => {
  const states: string[] = []
  const ai: Pick<WorkersAiClient, "clef"> = { async clef(_q, state) { states.push(state); return { category: { type: "choice", choice: "c1", confidence: 0.5, probabilities: {} } } } }
  await clefSuggestions(ai, [target()], categories, { history: [evidence(1, 1), evidence(2, 2), evidence(3, 1)] })
  expect(states[0]).toContain("Earlier with this description: Category 1 ×2, Category 2 ×1")
})

test.each([1, 2, undefined])("Clef caps concurrency (%s), streams results, continues after failures and drops unknown keys", async (concurrency) => {
  let active = 0, peak = 0
  const errors: Array<[number, unknown]> = []
  const arrived: number[] = []
  const failure = new Error("fake failure")
  const ai: Pick<WorkersAiClient, "clef"> = {
    async clef(questions, state, model) {
      expect(questions).toEqual({ category: clefQuestion(categories) })
      expect(model).toBe("clef")
      const id = Number(state.split("\n")[0]!.slice("Description: ".length))
      active++
      peak = Math.max(peak, active)
      await Bun.sleep(2)
      active--
      if (id === 2) throw failure
      return { category: { type: "choice", choice: id === 3 ? "c999" : id === 4 ? "c3" : "c1", confidence: 0.8, probabilities: {} } }
    },
  }
  const results = await clefSuggestions(ai, Array.from({ length: 8 }, (_, id) => transaction({ id, description: String(id) })), categories, {
    concurrency, onSuggestion: (s) => arrived.push(s.transactionId), onError: (id, error) => errors.push([id, error]),
  })
  expect(peak).toBe(concurrency ?? 4)
  expect(errors).toEqual([[2, failure]])
  expect(results.map((s) => s.transactionId).sort()).toEqual([0, 1, 5, 6, 7])
  expect(arrived).toEqual(results.map((s) => s.transactionId))
  expect(results.every((s) => s.categoryId === 1 && s.confidence === 0.8 && s.source === "clef")).toBe(true)
})

test("Clef skips an empty category list and rejects invalid concurrency", async () => {
  const ai: Pick<WorkersAiClient, "clef"> = { clef: async () => { throw new Error("must not call") } }
  expect(await clefSuggestions(ai, [target()], [])).toEqual([])
  await expect(clefSuggestions(ai, [target()], categories, { concurrency: 0 })).rejects.toThrow("concurrency must be a positive integer")
})


test("Clef drops a group key even when it names an existing category", async () => {
  const ai: Pick<WorkersAiClient, "clef"> = { clef: async () => ({ category: { type: "choice", choice: "c1", probabilities: {}, confidence: 1 } }) }
  expect(await clefSuggestions(ai, [target()], [...categories, category({ id: 4, parentId: 1 })])).toEqual([])
})
