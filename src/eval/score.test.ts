import { expect, test } from "bun:test"
import { scoreSuggestions, suggestionText } from "./score"
import type { CategorySuggestion } from "../domain/types"

const names: Record<number, string> = { 1: "Groceries", 2: "Takeaway", 3: "Fuel" }
const s = (transactionId: number, categoryId: number, confidence: number, source: "history" | "jev", ranked?: number[]): CategorySuggestion =>
  ({ transactionId, categoryId, confidence, source, ranked: ranked?.map((id) => ({ categoryId: id, confidence: 0.1 })) })

test("right, top 3, accept-all and confusions, by source and by whether the merchant was seen", () => {
  const hidden = [
    { id: 1, truth: "Groceries", description: "a", heldOut: false },
    { id: 2, truth: "Takeaway", description: "b", heldOut: true },
    { id: 3, truth: "Fuel", description: "c", heldOut: true },
    { id: 4, truth: "Fuel", description: "d", heldOut: true },
  ]
  const report = scoreSuggestions(hidden, {
    1: s(1, 1, 0.9, "history"),
    2: s(2, 1, 0.85, "jev", [1, 2]),
    3: s(3, 3, 0.6, "jev"),
  }, (id) => names[id]!)
  expect(report.all).toEqual({ rows: 4, suggested: 3, right: 2, top3: 3, sure: 2, sureRight: 1 })
  expect(report.heldOut).toMatchObject({ rows: 3, suggested: 2, right: 1 })
  expect(report.known).toMatchObject({ rows: 1, right: 1 })
  expect(report.bySource.jev).toMatchObject({ rows: 2, right: 1, sure: 1, sureRight: 0 })
  expect(report.confusions).toEqual([{ truth: "Takeaway", pick: "Groceries", rows: 1 }])
  expect(report.calibration.map((b) => [b.rows, b.right])).toEqual([[0, 0], [1, 1], [2, 1]])
  const text = suggestionText(report, report).join("\n")
  expect(text).toContain("66.7%")
  expect(text).toContain("(+0.0)")
  expect(text).toContain("Takeaway → Groceries")
})
