import { expect, test } from "bun:test"
import { hasIgnoreTag, isHeld, isIncome, isOrdinaryFlow, isSpending, isUncategorised, isUnsortedIn } from "./moneyRules"
import type { Transaction } from "./types"

test("money rules keep sign, category, income, exclusion, IGNORE and held status independent", () => {
  const categories = [
    { categoryId: null, categoryName: "Uncategorised" },
    { categoryId: 10, categoryName: "Uncategorised" },
    { categoryId: 5, categoryName: "Groceries" },
  ]
  for (const amount of [-1, 0, 1]) {
    for (const category of categories) {
      for (const income of [false, true]) {
        for (const excluded of [false, true]) {
          for (const tagNames of [[], ["iGnOrE"], [" IGNORE "]]) {
            for (const status of [null, "HELD", "SETTLED"] satisfies Transaction["status"][]) {
              const row = { amount, ...category, income, excluded, tagNames, status }
              const ignored = tagNames.includes("iGnOrE")
              const ordinary = !excluded && !ignored
              const uncategorised = category.categoryName === "Uncategorised"
              expect(hasIgnoreTag(row)).toBe(ignored)
              expect(isOrdinaryFlow(row)).toBe(ordinary)
              expect(isUncategorised(row)).toBe(uncategorised)
              // Income is the income categories, whatever the sign.
              expect(isIncome(row)).toBe(ordinary && income)
              // Spending: money out, or money back into a spending category.
              expect(isSpending(row)).toBe(ordinary && !income && (amount < 0 || (amount > 0 && !uncategorised)))
              // Uncategorised money in is neither until it gets a category.
              expect(isUnsortedIn(row)).toBe(ordinary && !income && amount > 0 && uncategorised)
              expect(isHeld(row)).toBe(status === "HELD")
            }
          }
        }
      }
    }
  }
})
