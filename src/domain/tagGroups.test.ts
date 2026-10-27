import { describe, expect, test } from "bun:test"
import { transaction } from "../testing/fixtures"
import type { Transaction } from "./types"
import { detectRecurring, detectTrips } from "./tagGroups"

let nextId = 1
const row = (o: Partial<Transaction>): Transaction => transaction({ id: nextId++, ...o })
const spend = (dateISO: string, description: string, o: Partial<Transaction> = {}) => row({ dateISO, description, amount: -10, transactionType: "Purchase", ...o })
const sgd = (dateISO: string, description: string, cardMethod: string | null = "CONTACTLESS", amount = -10) =>
  spend(dateISO, description, { amount, foreignAmount: `SGD ${(amount * 0.95).toFixed(2)}`, cardMethod, transactionType: "International Purchase" })

describe("trips", () => {
  test("a run of in-person foreign spending is a trip; same-currency rows near it join; online foreign spending and lone rows don't", () => {
    nextId = 1
    const anchors = [sgd("2026-05-22", "Si Chuan"), sgd("2026-05-22", "7-Eleven"), sgd("2026-05-24", "Hawker Centre"), sgd("2026-05-25", "Starbucks")]
    const online = sgd("2026-05-23", "Grab", "ECOMMERCE")
    const refund = sgd("2026-06-04", "Tech House refund", null, 12)
    const tooLate = sgd("2026-06-20", "SGD subscription", "ECOMMERCE")
    const usdOnline = [1, 2, 3, 4].map((m) => spend(`2026-0${m}-06`, "OpenAI", { foreignAmount: "USD -22.00", cardMethod: "CARD_ON_FILE", transactionType: "International Purchase" }))
    const lone = spend("2026-08-01", "Tokyo kiosk", { foreignAmount: "JPY -500", cardMethod: "CONTACTLESS", transactionType: "International Purchase" })
    const second = [sgd("2026-11-02", "Changi"), sgd("2026-11-02", "Jewel"), sgd("2026-11-03", "Hawker")]
    const domestic = spend("2026-05-21", "Qantas")
    const trips = detectTrips([...anchors, online, refund, tooLate, ...usdOnline, lone, ...second, domestic])
    // Newest first; a gap of more than 7 days between in-person rows splits trips.
    expect(trips.map((t) => [t.kind, t.name, t.start, t.end])).toEqual([
      ["trip", "Singapore Nov 2026", "2026-11-02", "2026-11-03"],
      ["trip", "Singapore May 2026", "2026-05-22", "2026-05-25"],
    ])
    // In person: 0.95. Same currency from 3 days before to 14 days after: 0.85. Domestic rows are left for Jev.
    expect(trips[1]!.rows).toEqual([
      ...anchors.map((t) => ({ id: t.id, confidence: 0.95 })),
      { id: online.id, confidence: 0.85 },
      { id: refund.id, confidence: 0.85 },
    ].sort((a, b) => a.id - b.id))
    expect(trips[1]!.detail).toBe("4 in person, 2 more in SGD · 22–25 May 2026")
  })

  test("a trip needs 3 in-person rows; an unknown currency is named by its code", () => {
    nextId = 100
    const two = [sgd("2026-05-22", "a"), sgd("2026-05-23", "b")]
    expect(detectTrips(two)).toEqual([])
    const xyz = ["2026-03-01", "2026-03-01", "2026-03-02"].map((d) => spend(d, "x", { foreignAmount: "XYZ -1", cardMethod: "CHIP", transactionType: "International Purchase" }))
    expect(detectTrips(xyz).map((t) => t.name)).toEqual(["XYZ Mar 2026"])
  })

  test("a trip across months names the month it started", () => {
    nextId = 200
    const rows = ["2026-05-30", "2026-05-31", "2026-06-02"].map((d) => sgd(d, "x"))
    expect(detectTrips(rows)[0]).toMatchObject({ name: "Singapore May 2026", start: "2026-05-30", end: "2026-06-02", detail: "3 in person · 30 May – 2 Jun 2026" })
  })
})

describe("regular payments", () => {
  test("merchants charging on a steady cadence and amount make one Subscriptions suggestion; people, money in and irregular spending don't", () => {
    nextId = 300
    const netflix = ["2026-01-05", "2026-02-05", "2026-03-06", "2026-04-05", "2026-05-05"].map((d) => spend(d, "Netflix", { amount: -18.99 }))
    // One double charge among steady ones still counts (most amounts near the usual).
    const openai = [["2026-01-06", -33], ["2026-02-06", -33], ["2026-03-06", -62], ["2026-04-06", -31.5]].map(([d, a]) => spend(d as string, "OpenAI", { amount: a as number }))
    const gym = ["2026-01-01", "2026-01-15", "2026-01-29", "2026-02-12"].map((d) => spend(d, "Gym", { amount: -25 }))
    const coles = ["2026-01-01", "2026-01-03", "2026-01-12", "2026-01-13", "2026-01-28"].map((d) => spend(d, "Coles", { amount: -40 }))
    const rent = ["2026-01-01", "2026-02-01", "2026-03-01"].map((d) => spend(d, "$friend_b", { amount: -800, transactionType: "Pay Anyone" }))
    const pay = ["2026-01-14", "2026-02-14", "2026-03-14"].map((d) => row({ dateISO: d, description: "Employer", amount: 3000, transactionType: "Salary" }))
    const yearly = ["2025-03-01", "2026-03-01"].map((d) => spend(d, "Domain", { amount: -20 }))
    const groups = detectRecurring([...netflix, ...openai, ...gym, ...coles, ...rent, ...pay, ...yearly])
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ kind: "recurring", name: "Subscriptions", detail: "Gym fortnightly · Netflix monthly · OpenAI monthly" })
    expect(groups[0]!.rows).toEqual([...netflix, ...openai, ...gym].map((t) => ({ id: t.id, confidence: 0.9 })).sort((a, b) => a.id - b.id))
  })

  test("nothing regular, no suggestion", () => {
    nextId = 400
    expect(detectRecurring([spend("2026-01-01", "Once")])).toEqual([])
  })
})
