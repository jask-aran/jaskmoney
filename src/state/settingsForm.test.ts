import { describe, expect, test } from "bun:test"
import { cycleFor } from "../domain/budget"
import { editorFields, pickerChoices, pickerItems, stepChoice, anchorChoices, anchorDraft, cycleFromDraft, normaliseCycleDraft, type Draft } from "./settingsForm"
import type { Account, Category } from "../domain/types"
import { ui } from "./uiStore"

const category = (id: number, name: string, parentId: number | null = null): Category => ({
  id, name, color: "#fff", sortOrder: id, isDefault: false, parentId, extId: null, notSpending: false,
} as Category)
const account = { id: 1, name: "Spending", type: "debit", sortOrder: 1, isActive: true, source: "up", externalKind: "TRANSACTIONAL", balance: 1, syncEnabled: true } as Account
const ctx = { accounts: [account], categories: [category(1, "Home"), category(2, "Groceries", 1), category(3, "People")], tags: [], savedFilters: [] }
const draft: Draft = { ...ui.state.settingsDraft, scopeKey: "overall", amount: "2000", unit: "month", anchor: "calendar", anchorDate: "" }

describe("settings form", () => {
  test("the budget editor carries the shared cycle; a date field only off calendar", () => {
    expect(editorFields("budget", draft, ctx).map((f) => f.label)).toEqual(["Covers", "Amount", "Every", "Starting"])
    expect(editorFields("budget", { ...draft, anchor: "date" }, ctx).map((f) => f.label)).toEqual(["Covers", "Amount", "Every", "Starting", "Day"])
    expect(editorFields("budget", draft, ctx)[0]).toMatchObject({ kind: "picker", display: "Overall spending" })
  })

  test("budget scopes group under headings and filter by group or name", () => {
    const items = pickerItems("budget", "scopeKey", ctx, "")
    expect(items.map((i) => (i.kind === "heading" ? `# ${i.label}` : i.label))).toEqual([
      "# Overall", "Overall spending", "# Accounts", "Spending", "# Home", "All of Home", "Groceries", "# Other", "People",
    ])
    expect(pickerChoices(pickerItems("budget", "scopeKey", ctx, "home")).map((i) => i.label)).toEqual(["All of Home", "Groceries"])
  })

  test("each unit asks for its start in its own form", () => {
    const fields = (d: Partial<typeof draft>) => editorFields("cycle", { ...draft, ...d }, ctx).map((f) => `${f.label}:${f.kind}`)
    expect(fields({ unit: "month", anchor: "date", anchorDate: "15" })).toEqual(["Every:choice", "Starting:choice", "Day:text"])
    expect(fields({ unit: "week", anchor: "date", anchorDate: "Thursday" })).toEqual(["Every:choice", "Starting:choice", "Weekday:choice"])
    expect(fields({ unit: "fortnight", anchor: "date", anchorDate: "2026-10-16" })).toEqual(["Every:choice", "Starting:choice", "Date:text"])
    expect(anchorChoices("week")).toEqual(["calendar", "date"])
  })

  test("drafts turn into stored cycles and back", () => {
    expect(cycleFromDraft({ unit: "month", anchor: "date", anchorDate: "15th" })).toEqual({ unit: "month", anchor: "date", anchorDate: "2000-01-15" })
    expect(cycleFromDraft({ unit: "month", anchor: "date", anchorDate: "32" })).toBe("Day must be 1–31")
    expect(cycleFromDraft({ unit: "week", anchor: "date", anchorDate: "Thursday" })).toEqual({ unit: "week", anchor: "date", anchorDate: "1970-01-08" })
    expect(cycleFromDraft({ unit: "fortnight", anchor: "date", anchorDate: "2026-02-30" })).toBe("Date must be YYYY-MM-DD")
    expect(cycleFromDraft({ unit: "month", anchor: "calendar", anchorDate: "anything" })).toEqual({ unit: "month", anchor: "calendar", anchorDate: null })
    // Old full-date anchors read back in the unit's form.
    expect(anchorDraft({ unit: "month", anchor: "date", anchorDate: "2026-10-15" })).toBe("15")
    expect(anchorDraft({ unit: "week", anchor: "date", anchorDate: "2026-10-15" })).toBe("Thursday")
    // A monthly 15th cycles from the 15th whatever year the anchor names.
    const stored = cycleFromDraft({ unit: "month", anchor: "date", anchorDate: "15" })
    expect(typeof stored !== "string" && cycleFor(stored, "2026-10-26")).toMatchObject({ start: "2026-10-15", end: "2026-11-14" })
  })

  test("changing the unit resets the start to the new unit's form", () => {
    expect(normaliseCycleDraft({ ...draft, unit: "week", anchor: "weekStartNearDate", anchorDate: "15" }, "month")).toEqual({ anchor: "calendar", anchorDate: "Monday" })
    expect(normaliseCycleDraft({ ...draft, unit: "month", anchor: "date", anchorDate: "15" }, "month")).toEqual({ anchor: "date", anchorDate: "15" })
  })

  test("choices wrap both ways", () => {
    expect(stepChoice(["week", "fortnight", "month"], "month", 1)).toBe("week")
    expect(stepChoice(["week", "fortnight", "month"], "week", -1)).toBe("month")
  })
})
