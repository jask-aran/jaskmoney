import { expect, test } from "bun:test"
import { hasIgnoreTag, isHeld, isIncome, isOrdinaryFlow, isSpending } from "./moneyRules"
import type { Transaction } from "./types"

test("money rules keep sign, exclusion, IGNORE and held status independent", () => {
  for (const amount of [-1, 0, 1]) {
    for (const excluded of [false, true]) {
      for (const tagNames of [[], ["iGnOrE"], [" IGNORE "]]) {
        for (const status of [null, "HELD", "SETTLED"] satisfies Transaction["status"][]) {
          const row = { amount, excluded, tagNames, status }
          const ignored = tagNames.includes("iGnOrE")
          const ordinary = !excluded && !ignored
          expect(hasIgnoreTag(row)).toBe(ignored)
          expect(isOrdinaryFlow(row)).toBe(ordinary)
          expect(isSpending(row)).toBe(amount < 0 && ordinary)
          expect(isIncome(row)).toBe(amount > 0 && ordinary)
          expect(isHeld(row)).toBe(status === "HELD")
        }
      }
    }
  }
})
