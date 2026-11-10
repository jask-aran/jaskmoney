import { tagCovers } from "../domain/tagScope"
import { describeCycle, type CycleAnchor, type CycleConfig, type CycleUnit } from "../domain/budget"
import { budgetScopeOptions } from "../domain/budgetScopes"
import { appToday } from "../domain/days"
import { fuzzyScore } from "../domain/fuzzy"
import { categoryPickerRows } from "../domain/categoryOptions"
import { applyTop, canonicalFilter, evalFilter, parseFilterStrict } from "../domain/filter"
import { filterRowNames } from "../domain/rules"
import type { Account, Category, SavedFilter, Tag, Transaction } from "../domain/types"
import type { SettingsEditorKind, UiState } from "./uiStore"

type Draft = UiState["settingsDraft"]
type FieldKind = "text" | "choice" | "toggle" | "picker"

export interface FormField {
  key: keyof Draft
  label: string
  kind: FieldKind
  display: string
  choices?: readonly string[]
  multi?: boolean
}

export type PickerItem =
  | { kind: "heading"; label: string }
  | { kind: "item"; label: string; value: string | number | null; color?: string; detail?: string }

interface FormContext {
  accounts: Account[]
  categories: Category[]
  tags: Tag[]
  savedFilters: SavedFilter[]
  transactions: Transaction[]
}

const CYCLE_UNITS: readonly CycleUnit[] = ["week", "fortnight", "month"]
const UNIT_LABEL: Record<CycleUnit, string> = { week: "Week", fortnight: "Fortnight", month: "Month" }
export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const

function anchorChoices(unit: CycleUnit): readonly CycleAnchor[] {
  return unit === "week" ? ["calendar", "date"] : ["calendar", "date", "weekStartNearDate"]
}

const START_LABEL: Record<CycleUnit, Record<CycleAnchor, string>> = {
  month: { calendar: "the 1st", date: "a day of the month", weekStartNearDate: "the Monday nearest a day" },
  week: { calendar: "Monday", date: "another weekday", weekStartNearDate: "Monday" },
  fortnight: { calendar: "every other Monday", date: "a date", weekStartNearDate: "the Monday nearest a date" },
}

export function anchorDraft(cycle: CycleConfig): string {
  if (cycle.anchor === "calendar" || !cycle.anchorDate) return defaultAnchorDraft(cycle.unit)
  if (cycle.unit === "month") return String(Number(cycle.anchorDate.slice(8, 10)))
  if (cycle.unit === "week") return WEEKDAYS[(new Date(cycle.anchorDate + "T12:00:00Z").getUTCDay() + 6) % 7]!
  return cycle.anchorDate
}

function defaultAnchorDraft(unit: CycleUnit, today = appToday()): string {
  return unit === "month" ? "1" : unit === "week" ? "Monday" : today
}

export function normaliseCycleDraft(draft: Draft, previousUnit: CycleUnit): Pick<Draft, "anchor" | "anchorDate"> {
  const anchor = anchorChoices(draft.unit).includes(draft.anchor) ? draft.anchor : "calendar"
  return { anchor, anchorDate: draft.unit === previousUnit ? draft.anchorDate : defaultAnchorDraft(draft.unit) }
}

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
  pay: "Pay",
}

export function secretDisplay(value: string): string {
  return value ? `${"•".repeat(8)}  (${value.length} chars)` : "paste the key"
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
        { key: "categoryIds", label: "Categories", kind: "picker", multi: true, display: draft.categoryIds.map((id) => ctx.categories.find((c) => c.id === id)?.name).filter(Boolean).join(", ") || "any" },
        { key: "about", label: "About", kind: "text", display: draft.about },
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
    case "pay":
      return [{ key: "amount", label: "Each payday", kind: "text", display: draft.amount }]
  }
}

export function editorWidth(fields: FormField[], note: FormNote | null, hints: string): number {
  const label = Math.max(...fields.map((f) => f.label.length)) + 2
  const line = (f: FormField) =>
    2 + label + Math.max(f.display.length, f.kind === "text" ? 24 : 0) + (f.kind === "picker" ? 17 : f.kind === "text" ? 1 : 4)
  return Math.max(...fields.map(line), (note?.text ?? "").length + (note?.dot ? 2 : 0), hints.length)
}

export interface FormNote {
  text: string
  tone: "muted" | "ok" | "error"
  dot?: boolean
}

export function editorNote(kind: SettingsEditorKind, draft: Draft, ctx: FormContext): FormNote | null {
  if (kind === "filter" || kind === "rule") {
    const filterId = kind === "rule" ? draft.savedFilterId : ""
    if (kind === "rule" && !filterId) return { text: "pending", tone: "muted", dot: true }
    const filter = kind === "rule" ? ctx.savedFilters.find((filter) => filter.id === filterId) : null
    if (kind === "rule" && !filter) return { text: `missing: ${filterId}`, tone: "error", dot: true }
    const expr = kind === "filter" ? draft.expr : filter?.expr ?? ""
    if (!expr.trim() && kind === "filter") return { text: "empty", tone: "muted", dot: true }
    const saved = kind === "filter"
      ? canonicalFilter(expr, { cat: ctx.categories.map((c) => c.name), tag: ctx.tags.map((t) => t.name), acc: ctx.accounts.map((a) => a.name) })
      : { ...parseFilterStrict(expr), text: expr }
    const { node, error } = saved
    if (error || !node) return { text: kind === "filter" ? `invalid: ${error ?? "empty expression"}` : "invalid", tone: "error", dot: true }
    const names = filterRowNames(ctx.categories, ctx.tags)
    const count = applyTop(node, ctx.transactions.filter((txn) => evalFilter(node, names.row(txn, txn.categoryId, txn.tagIds)))).length
    const full = kind === "filter" && saved.text !== expr.trim() ? ` · saves as ${saved.text}` : ""
    return { text: `ok · ${count} txns${full}`, tone: "ok", dot: true }
  }
  if (kind === "tag") {
    const about = draft.about.trim() ? " · T reads About" : ""
    if (!draft.categoryIds.length) return { text: `any category${about}`, tone: "muted" }
    const count = ctx.transactions.filter(tagCovers({ categoryIds: draft.categoryIds }, ctx.categories)).length
    return { text: `${count} txns in its categories${about}`, tone: "ok", dot: true }
  }
  if (kind === "pay") return { text: "What you expect in, after tax · empty clears it", tone: "muted" }
  if (kind !== "budget" && kind !== "cycle") return null
  const cycle = cycleFromDraft(draft)
  const text = typeof cycle === "string" ? cycle : describeCycle(cycle)
  return { text: kind === "budget" ? `${text} · one cycle for every budget` : text, tone: "muted" }
}

export function pickerItems(kind: SettingsEditorKind, key: keyof Draft, ctx: Omit<FormContext, "transactions">, query: string): PickerItem[] {
  const q = query.trim().toLowerCase()
  const match = (...texts: string[]) => !q || texts.some((t) => fuzzyScore(q, t) !== null)
  if (key === "scopeKey") {
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
    const none: PickerItem[] = match("none") ? [{ kind: "item", label: "None", value: null }] : []
    return [
      ...none,
      ...categoryPickerRows(ctx.categories, query, false).map((r): PickerItem =>
        r.kind === "heading" ? r : { kind: "item", label: r.category.name, value: r.category.id, color: r.category.color }),
    ]
  }
  if (key === "savedFilterId") {
    return ctx.savedFilters.filter((f) => match(f.name, f.id)).map((f) => ({ kind: "item", label: f.name, value: f.id }))
  }
  if (key === "categoryIds") {
    const rows: PickerItem[] = []
    const groupIds = new Set(ctx.categories.map((c) => c.parentId).filter((id): id is number => id != null))
    const item = (c: Category, label = c.name): PickerItem => ({ kind: "item", label, value: c.id, color: c.color })
    if (q) {
      return ctx.categories.filter((c) => !c.isDefault).flatMap((c) => {
        const score = fuzzyScore(q, c.name)
        return score === null ? [] : [{ score, row: item(c, groupIds.has(c.id) ? `All of ${c.name}` : c.name) }]
      }).sort((a, b) => b.score - a.score).map((m) => m.row)
    }
    for (const group of ctx.categories.filter((c) => groupIds.has(c.id))) {
      const children = ctx.categories.filter((c) => c.parentId === group.id && match(c.name, group.name))
      if (!children.length && !match(group.name)) continue
      rows.push({ kind: "heading", label: group.name }, item(group, `All of ${group.name}`), ...children.map((c) => item(c)))
    }
    const others = ctx.categories.filter((c) => c.parentId == null && !groupIds.has(c.id) && !c.isDefault && match(c.name))
    if (others.length) rows.push({ kind: "heading", label: "Other" }, ...others.map((c) => item(c)))
    return rows
  }
  if (key === "addTagIds") {
    return ctx.tags.filter((t) => match(t.name)).map((t) => ({ kind: "item", label: t.name, value: t.id, color: t.color }))
  }
  return []
}

export function pickerChoices(items: PickerItem[]): Array<Extract<PickerItem, { kind: "item" }>> {
  return items.filter((i): i is Extract<PickerItem, { kind: "item" }> => i.kind === "item")
}

export function stepChoice<T>(values: readonly T[], current: T, step: number): T {
  const at = Math.max(0, values.indexOf(current))
  return values[(at + step + values.length) % values.length]!
}
