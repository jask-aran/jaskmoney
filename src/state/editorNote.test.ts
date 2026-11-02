import { expect, test } from "bun:test"
import { editorNote, type Draft } from "./settingsForm"
import { account, category, transaction } from "../testing/fixtures"

test("a filter's editor note says what it saves as when that differs from what was typed; refuses only what has no one reading", () => {
  const ctx = { accounts: [account({ name: "Spending" })], categories: [category({ id: 1, name: "Restaurants & Cafes" }), category({ id: 2, name: "Rates & Insurance" }), category({ id: 3, name: "Car Insurance" })], tags: [], savedFilters: [], transactions: [transaction({ categoryId: 1, categoryName: "Restaurants & Cafes" })] }
  const note = (expr: string) => editorNote("filter", { expr } as Draft, ctx)
  expect(note("cat:restaurants or kfc")).toMatchObject({ text: expect.stringContaining('cat:"Restaurants & Cafes" OR kfc'), tone: "ok" })
  expect(note("desc:zzz")!.text).not.toContain("saves as")
  expect(note("desc:zzz")!.tone).toBe("ok")
  expect(note("cat:insurance")!.tone).toBe("error")
})
