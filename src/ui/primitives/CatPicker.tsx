import { Show, createMemo } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { categoryPickerRows } from "../../domain/categoryOptions"
import type { PickerItem } from "../../state/settingsForm"
import { ListPicker } from "./ListPicker"
import { categoryMark } from "../icons"

/** Choose a category for the target transactions, grouped and filterable. */
export function CatPicker() {
  const items = createMemo((): PickerItem[] => categoryPickerRows(data.state.categories, ui.state.catPickerQuery).map((r) =>
    r.kind === "heading" ? r : { kind: "item", label: r.category.name, value: r.category.id, color: r.category.color }))
  const targets = () => ui.state.pickerTargets.length
  return (
    <Show when={ui.state.catPickerOpen}>
      <ListPicker
        title="Category"
        subtitle={`${targets()} transaction${targets() === 1 ? "" : "s"}`}
        items={items()}
        cursor={ui.state.catPickerCursor}
        query={ui.state.catPickerQuery}
        iconFor={(value) => categoryMark(Number(value))}
        hints="j/k move · enter apply · esc cancel"
      />
    </Show>
  )
}
