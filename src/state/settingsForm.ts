import { describeCycle, type CycleAnchor, type CycleConfig, type CycleUnit } from "../domain/budget"
import { budgetScopeOptions } from "../domain/budgetScopes"
import { appToday } from "../domain/days"
import { fuzzyScore } from "../domain/fuzzy"
import { categoryPickerRows } from "../domain/categoryOptions"
import { evalFilter, parseFilterStrict } from "../domain/filter"
import { filterRowNames } from "../domain/rules"
import type { Account, Category, SavedFilter, Tag, Transaction } from "../domain/types"
import type { SettingsEditorKind, UiState } from "./uiStore"

/**
 * The Settings editors as data: each editor kind is a list of fields over the
 * shared draft. Key handling and rendering both read this list, so a field's
 * position, kind and value text come from one place.
 *
 * - text: printable keys edit it; it shows a caret when focused.
 * - choice: h/l, ←/→ or space step through `choices`.
 * - toggle: h/l, ←/→ or space flip it.
 * - picker: enter opens a filterable list (`pickerItems`).
 */
export type Draft = UiState["settingsDraft"]
export type FieldKind = "text" | "choice" | "toggle" | "picker"

export interface FormField {
  key: keyof Draft
  label: string
  kind: FieldKind
  /** The value as shown. */
  display: string
  /** choice: the values in order. */
  choices?: readonly string[]
  /** picker: several values (toggle each with enter) rather than one. */
  multi?: boolean
}

/** A row of a picker list: a group heading or a choosable item. */
export type PickerItem =
  | { kind: "heading"; label: string }
  | { kind: "item"; label: string; value: string | number | null; color?: string; detail?: string }

export interface FormContext {
  accounts: Account[]
  categories: Category[]
  tags: Tag[]
  savedFilters: SavedFilter[]
  transactions: Transaction[]
}

export const CYCLE_UNITS: readonly CycleUnit[] = ["week", "fortnight", "month"]
const UNIT_LABEL: Record<CycleUnit, string> = { week: "Week", fortnight: "Fortnight", month: "Month" }
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const

/**
 * The budget cycle's start, asked the way each unit needs it: a month by the
 * day of the month (the 15th), a week by its weekday, a fortnight by a date
 * (only a date says which week it starts in). The draft's `anchorDate` holds
 * that answer as typed ("15", "Thursday", "2026-10-16"); `cycleFromDraft`
 * turns it into the stored anchor date. "Monday nearest" makes no sense for
 * weeks, so weeks offer only the first two starts.
 */
export function anchorChoices(unit: CycleUnit): readonly CycleAnchor[] {
  return unit === "week" ? ["calendar", "date"] : ["calendar", "date", "weekStartNearDate"]
}

const START_LABEL: Record<CycleUnit, Record<CycleAnchor, string>> = {
  month: { calendar: "the 1st", date: "a day of the month", weekStartNearDate: "the Monday nearest a day" },
  week: { calendar: "Monday", date: "another weekday", weekStartNearDate: "Monday" },
  fortnight: { calendar: "every other Monday", date: "a date", weekStartNearDate: "the Monday nearest a date" },
}

/** The start field's draft text for a stored cycle. */
export function anchorDraft(cycle: CycleConfig): string {
  if (cycle.anchor === "calendar" || !cycle.anchorDate) return defaultAnchorDraft(cycle.unit)
  if (cycle.unit === "month") return String(Number(cycle.anchorDate.slice(8, 10)))
  if (cycle.unit === "week") return WEEKDAYS[(new Date(cycle.anchorDate + "T12:00:00Z").getUTCDay() + 6) % 7]!
  return cycle.anchorDate
}

/** What the start field holds for a unit before anything is typed. */
export function defaultAnchorDraft(unit: CycleUnit, today = appToday()): string {
  return unit === "month" ? "1" : unit === "week" ? "Monday" : today
}

/** After the unit or start changes: a start the unit offers, and a draft in
 * the unit's form. */
export function normaliseCycleDraft(draft: Draft, previousUnit: CycleUnit): Pick<Draft, "anchor" | "anchorDate"> {
  const anchor = anchorChoices(draft.unit).includes(draft.anchor) ? draft.anchor : "calendar"
  return { anchor, anchorDate: draft.unit === previousUnit ? draft.anchorDate : defaultAnchorDraft(draft.unit) }
}

/** The cycle the draft describes, or an error message. Months store the day
 * in a 31-day January (any year), weeks the weekday's date in the week of
 * Monday 5 Jan 1970; fortnights the date itself. */
export function cycleFromDraft(draft: Pick<Draft, "unit" | "anchor" | "anchorDate"> & Partial<Pick<Draft, "payEarly">>): CycleConfig | string {
  const cycle = scheduleFromDraft(draft)
  return typeof cycle === "string" ? cycle : { ...cycle, payEarly: !!draft.payEarly }
}

function scheduleFromDraft(draft: Pick<Draft, "unit" | "anchor" | "anchorDate">): CycleConfig | string {
  const { unit, anchor } = draft
  if (anchor === "calendar") return { unit, anchor, anchorDate: null }
  const text = draft.anchorDate.trim()
  if (unit === "month") {
    const day = Number(text.match(/^(\d{1,2})(st|nd|rd|th)?$/i)?.[1])
    if (!(day >= 1 && day <= 31)) return "Day must be 1–31"
    return { unit, anchor, anchorDate: `2000-01-${String(day).padStart(2, "0")}` }
  }
  if (unit === "week") {
    const index = WEEKDAYS.indexOf(text as (typeof WEEKDAYS)[number])
    if (index < 0) return "Choose a weekday"
    return { unit, anchor, anchorDate: `1970-01-${String(5 + index).padStart(2, "0")}` }
  }
  const real = /^\d{4}-\d{2}-\d{2}$/.test(text) && new Date(text + "T12:00:00Z").toISOString().slice(0, 10) === text
  return real ? { unit, anchor, anchorDate: text } : "Date must be YYYY-MM-DD"
}

export const EDITOR_TITLE: Record<SettingsEditorKind, string> = {
  category: "Category",
  tag: "Tag",
  filter: "Saved filter",
  rule: "Rule",
  budget: "Budget",
  cycle: "Budget cycle",
}

function cycleFields(draft: Draft): FormField[] {
  const start: FormField[] =
    draft.anchor === "calendar" ? []
      : draft.unit === "week" ? [{ key: "anchorDate", label: "Weekday", kind: "choice", display: draft.anchorDate, choices: WEEKDAYS }]
      : [{ key: "anchorDate", label: draft.unit === "month" ? "Day" : "Date", kind: "text", display: draft.anchorDate }]
  return [
    { key: "unit", label: "Every", kind: "choice", display: UNIT_LABEL[draft.unit], choices: CYCLE_UNITS },
    { key: "anchor", label: "Starting", kind: "choice", display: START_LABEL[draft.unit][draft.anchor], choices: anchorChoices(draft.unit) },
    ...start,
    { key: "payEarly", label: "Payday", kind: "toggle", display: draft.payEarly ? "start early when pay comes first" : "no" },
  ]
}

export function editorFields(kind: SettingsEditorKind, draft: Draft, ctx: Omit<FormContext, "transactions">): FormField[] {
  const categoryName = (id: number | null, none: string) => ctx.categories.find((c) => c.id === id)?.name ?? none
  switch (kind) {
    case "category":
      return [
        { key: "name", label: "Name", kind: "text", display: draft.name },
        { key: "color", label: "Colour", kind: "text", display: draft.color },
        { key: "notSpending", label: "Spending", kind: "toggle", display: draft.notSpending ? "no, excluded from spending and income" : "yes" },
      ]
    case "tag":
      return [
        { key: "name", label: "Name", kind: "text", display: draft.name },
        { key: "color", label: "Colour", kind: "text", display: draft.color },
        { key: "categoryId", label: "Scope", kind: "picker", display: categoryName(draft.categoryId, "global") },
      ]
    case "filter":
      return [
        { key: "id", label: "ID", kind: "text", display: draft.id },
        { key: "name", label: "Name", kind: "text", display: draft.name },
        { key: "expr", label: "Expression", kind: "text", display: draft.expr },
      ]
    case "rule":
      return [
        { key: "name", label: "Name", kind: "text", display: draft.name },
        { key: "savedFilterId", label: "Filter", kind: "picker", display: ctx.savedFilters.find((f) => f.id === draft.savedFilterId)?.name ?? (draft.savedFilterId || "—") },
        { key: "setCategoryId", label: "Category", kind: "picker", display: categoryName(draft.setCategoryId, "—") },
        { key: "addTagIds", label: "Tags", kind: "picker", multi: true, display: draft.addTagIds.map((id) => ctx.tags.find((t) => t.id === id)?.name).filter(Boolean).join(", ") || "—" },
      ]
    case "budget":
      return [
        { key: "scopeKey", label: "Covers", kind: "picker", display: budgetScopeOptions(ctx.accounts, ctx.categories).find((o) => o.key === draft.scopeKey)?.label ?? "—" },
        { key: "amount", label: "Amount", kind: "text", display: draft.amount },
        ...cycleFields(draft),
      ]
    case "cycle":
      return cycleFields(draft)
  }
}

/**
 * Columns an editor needs: the widest field line as Form draws it (marker,
 * padded label, value, then the focused decoration: "‹ ›", a caret, or the
 * picker's "enter to choose"), the note and the hint line. Fields whose value
 * is typed get room to grow, so the dialog does not resize on every key.
 */
export function editorWidth(fields: FormField[], note: FormNote | null, hints: string): number {
  const label = Math.max(...fields.map((f) => f.label.length)) + 2
  const line = (f: FormField) =>
    2 + label + Math.max(f.display.length, f.kind === "text" ? 24 : 0) + (f.kind === "picker" ? 17 : f.kind === "text" ? 1 : 4)
  return Math.max(...fields.map(line), (note?.text ?? "").length + (note?.dot ? 2 : 0), hints.length)
}

/** A line under an editor's fields: a muted explanation, or (filters and
 * rules) a coloured status with a dot. */
export interface FormNote {
  text: string
  tone: "muted" | "ok" | "error"
  dot?: boolean
}

/** The note for an editor, when it has one: a filter's or rule's live
 * status with its match count, or the budget cycle described. */
export function editorNote(kind: SettingsEditorKind, draft: Draft, ctx: FormContext): FormNote | null {
  if (kind === "filter" || kind === "rule") {
    const filterId = kind === "rule" ? draft.savedFilterId : ""
    if (kind === "rule" && !filterId) return { text: "pending", tone: "muted", dot: true }
    const filter = kind === "rule" ? ctx.savedFilters.find((filter) => filter.id === filterId) : null
    if (kind === "rule" && !filter) return { text: `missing: ${filterId}`, tone: "error", dot: true }
    const expr = kind === "filter" ? draft.expr : filter?.expr ?? ""
    if (!expr.trim() && kind === "filter") return { text: "empty", tone: "muted", dot: true }
    const { node, error } = parseFilterStrict(expr)
    if (error || !node) return { text: kind === "filter" ? `invalid: ${error ?? "empty expression"}` : "invalid", tone: "error", dot: true }
    const names = filterRowNames(ctx.categories, ctx.tags)
    const count = ctx.transactions.filter((txn) => evalFilter(node, names.row(txn, txn.categoryId, txn.tagIds))).length
    return { text: `ok · ${count} txns`, tone: "ok", dot: true }
  }
  if (kind !== "budget" && kind !== "cycle") return null
  const cycle = cycleFromDraft(draft)
  const text = typeof cycle === "string" ? cycle : describeCycle(cycle)
  return { text: kind === "budget" ? `${text} · one cycle for every budget` : text, tone: "muted" }
}

/** The rows a picker field offers, filtered by `query` (case-insensitive). */
export function pickerItems(kind: SettingsEditorKind, key: keyof Draft, ctx: Omit<FormContext, "transactions">, query: string): PickerItem[] {
  const q = query.trim().toLowerCase()
  const match = (...texts: string[]) => !q || texts.some((t) => fuzzyScore(q, t) !== null)
  if (key === "scopeKey") {
    // Overall and accounts first; then each category group as a heading
    // with the whole group as its first item, and ungrouped categories
    // under Other.
    const rows: PickerItem[] = []
    let heading = ""
    const push = (group: string, label: string, value: string, search: string) => {
      if (!match(search, group)) return
      if (group !== heading) { rows.push({ kind: "heading", label: group }); heading = group }
      rows.push({ kind: "item", label, value })
    }
    const groupIds = new Set(ctx.categories.map((c) => c.parentId).filter((id): id is number => id != null))
    for (const option of budgetScopeOptions(ctx.accounts, ctx.categories)) {
      const scope = option.scope
      if (scope.kind === "overall") push("Overall", option.label, option.key, option.label)
      else if (scope.kind === "account") push("Accounts", option.label.replace(/^Account · /, ""), option.key, option.label)
      else {
        const category = ctx.categories.find((c) => c.id === scope.categoryId)
        const parent = category?.parentId != null ? ctx.categories.find((c) => c.id === category.parentId) : undefined
        if (parent) push(parent.name, category!.name, option.key, `${parent.name} ${category!.name}`)
        else if (category && groupIds.has(category.id)) push(category.name, `All of ${category.name}`, option.key, category.name)
        else push("Other", option.label, option.key, option.label)
      }
    }
    return rows
  }
  if (key === "categoryId" || key === "setCategoryId") {
    const none: PickerItem[] = match(kind === "tag" ? "global" : "none") ? [{ kind: "item", label: kind === "tag" ? "Global (every category)" : "None", value: null }] : []
    return [
      ...none,
      ...categoryPickerRows(ctx.categories, query, false).map((r): PickerItem =>
        r.kind === "heading" ? r : { kind: "item", label: r.category.name, value: r.category.id, color: r.category.color }),
    ]
  }
  if (key === "savedFilterId") {
    return ctx.savedFilters.filter((f) => match(f.name, f.id)).map((f) => ({ kind: "item", label: f.name, value: f.id }))
  }
  if (key === "addTagIds") {
    return ctx.tags.filter((t) => match(t.name)).map((t) => ({ kind: "item", label: t.name, value: t.id, color: t.color }))
  }
  return []
}

/** Choosable rows only, in display order (the picker cursor indexes these). */
export function pickerChoices(items: PickerItem[]): Array<Extract<PickerItem, { kind: "item" }>> {
  return items.filter((i): i is Extract<PickerItem, { kind: "item" }> => i.kind === "item")
}

/** Step a choice field's value. */
export function stepChoice<T>(values: readonly T[], current: T, step: number): T {
  const at = Math.max(0, values.indexOf(current))
  return values[(at + step + values.length) % values.length]!
}
