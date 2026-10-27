import { Show, createMemo } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { categoryPickerRows, pickerSuggestions } from "../../domain/categoryOptions"
import type { PickerItem } from "../../state/settingsForm"
import { ListPicker } from "./ListPicker"
import { categoryMark } from "../icons"
import { count } from "../text"

/** Choose a category for the target transactions, grouped and filterable;
 * their suggested categories first. */
export function CatPicker() {
  const suggested = createMemo(() => pickerSuggestions(ui.state.pickerTargets, data.state.suggestions))
  const items = createMemo((): PickerItem[] => categoryPickerRows(data.state.categories, ui.state.catPickerQuery, true, suggested()).map((r) =>
    r.kind === "heading" ? r : { kind: "item", label: r.category.name, value: r.category.id, color: r.category.color, ...(r.confidence !== undefined ? { detail: `${Math.round(r.confidence * 100)}%` } : {}) }))
  const targets = () => ui.state.pickerTargets.length
  return (
    <Show when={ui.state.catPickerOpen}>
      <ListPicker
        title="Category"
        subtitle={count(targets(), "transaction")}
        items={items()}
        cursor={ui.state.catPickerCursor}
        query={ui.state.catPickerQuery}
        iconFor={(value) => categoryMark(Number(value))}
        hints="↑↓ ^j/k move · enter apply · esc cancel"
      />
    </Show>
  )
}
