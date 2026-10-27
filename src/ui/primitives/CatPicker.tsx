import { Show, createMemo } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { categoryPickerRows, suggestedCategoryIds } from "../../domain/categoryOptions"
import type { PickerItem } from "../../state/settingsForm"
import { ListPicker } from "./ListPicker"
import { categoryMark } from "../icons"
import { count } from "../text"

/** Choose a category for the target transactions, grouped and filterable;
 * their suggested categories first. */
export function CatPicker() {
  const suggested = createMemo(() => suggestedCategoryIds(ui.state.pickerTargets, data.state.suggestions))
  const items = createMemo((): PickerItem[] => categoryPickerRows(data.state.categories, ui.state.catPickerQuery, true, suggested()).map((r) =>
    r.kind === "heading" ? r : { kind: "item", label: r.category.name, value: r.category.id, color: r.category.color }))
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
        hints="↑↓ move · enter apply · esc cancel"
      />
    </Show>
  )
}
