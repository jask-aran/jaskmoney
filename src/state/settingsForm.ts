import { ANCHOR_LABEL, describeCycle, type CycleAnchor, type CycleConfig, type CycleUnit } from "../domain/budget"
import { budgetScopeOptions } from "../domain/budgetScopes"
import { categoryPickerRows } from "../domain/categoryOptions"
import type { Account, Category, SavedFilter, Tag } from "../domain/types"
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
  | { kind: "item"; label: string; value: string | number | null; color?: string }

export interface FormContext {
  accounts: Account[]
  categories: Category[]
  tags: Tag[]
  savedFilters: SavedFilter[]
}

export const CYCLE_UNITS: readonly CycleUnit[] = ["week", "fortnight", "month"]
export const CYCLE_ANCHORS: readonly CycleAnchor[] = ["calendar", "date", "weekStartNearDate"]
const UNIT_LABEL: Record<CycleUnit, string> = { week: "Week", fortnight: "Fortnight", month: "Month" }

export const EDITOR_TITLE: Record<SettingsEditorKind, string> = {
  category: "Category",
  tag: "Tag",
  filter: "Saved filter",
  rule: "Rule",
  budget: "Budget",
  cycle: "Budget cycle",
}

function cycleFields(draft: Draft): FormField[] {
  return [
    { key: "unit", label: "Every", kind: "choice", display: UNIT_LABEL[draft.unit], choices: CYCLE_UNITS },
    { key: "anchor", label: "Starting", kind: "choice", display: ANCHOR_LABEL[draft.anchor], choices: CYCLE_ANCHORS },
    ...(draft.anchor === "calendar" ? [] : [{ key: "anchorDate", label: "Date", kind: "text", display: draft.anchorDate } as FormField]),
  ]
}

export function editorFields(kind: SettingsEditorKind, draft: Draft, ctx: FormContext): FormField[] {
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

/** A line under the fields that explains the result, when there is one. */
export function editorNote(kind: SettingsEditorKind, draft: Draft): string | null {
  if (kind !== "budget" && kind !== "cycle") return null
  const cycle: CycleConfig = { unit: draft.unit, anchor: draft.anchor, anchorDate: draft.anchorDate || null }
  return kind === "budget" ? `${describeCycle(cycle)} · one cycle for every budget` : describeCycle(cycle)
}

/** The rows a picker field offers, filtered by `query` (case-insensitive). */
export function pickerItems(kind: SettingsEditorKind, key: keyof Draft, ctx: FormContext, query: string): PickerItem[] {
  const q = query.trim().toLowerCase()
  const match = (...texts: string[]) => !q || texts.some((t) => t.toLowerCase().includes(q))
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
      ...categoryPickerRows(ctx.categories, query).map((r): PickerItem =>
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
