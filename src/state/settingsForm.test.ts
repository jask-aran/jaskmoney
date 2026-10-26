import { describe, expect, test } from "bun:test"
import { editorFields, pickerChoices, pickerItems, stepChoice } from "./settingsForm"
import type { Account, Category } from "../domain/types"
import { ui } from "./uiStore"

const category = (id: number, name: string, parentId: number | null = null): Category => ({
  id, name, color: "#fff", sortOrder: id, isDefault: false, parentId, extId: null, notSpending: false,
} as Category)
const account = { id: 1, name: "Spending", type: "debit", sortOrder: 1, isActive: true, source: "up", externalKind: "TRANSACTIONAL", balance: 1, syncEnabled: true } as Account
const ctx = { accounts: [account], categories: [category(1, "Home"), category(2, "Groceries", 1), category(3, "People")], tags: [], savedFilters: [] }
const draft = { ...ui.state.settingsDraft, scopeKey: "overall", amount: "2000", unit: "month" as const, anchor: "calendar" as const, anchorDate: "" }

describe("settings form", () => {
  test("the budget editor carries the shared cycle; a date field only off calendar", () => {
    expect(editorFields("budget", draft, ctx).map((f) => f.label)).toEqual(["Covers", "Amount", "Every", "Starting"])
    expect(editorFields("budget", { ...draft, anchor: "date" }, ctx).map((f) => f.label)).toEqual(["Covers", "Amount", "Every", "Starting", "Date"])
    expect(editorFields("budget", draft, ctx)[0]).toMatchObject({ kind: "picker", display: "Overall spending" })
  })

  test("budget scopes group under headings and filter by group or name", () => {
    const items = pickerItems("budget", "scopeKey", ctx, "")
    expect(items.map((i) => (i.kind === "heading" ? `# ${i.label}` : i.label))).toEqual([
      "# Overall", "Overall spending", "# Accounts", "Spending", "# Home", "All of Home", "Groceries", "# Other", "People",
    ])
    expect(pickerChoices(pickerItems("budget", "scopeKey", ctx, "home")).map((i) => i.label)).toEqual(["All of Home", "Groceries"])
  })

  test("choices wrap both ways", () => {
    expect(stepChoice(["week", "fortnight", "month"], "month", 1)).toBe("week")
    expect(stepChoice(["week", "fortnight", "month"], "week", -1)).toBe("month")
  })
})
