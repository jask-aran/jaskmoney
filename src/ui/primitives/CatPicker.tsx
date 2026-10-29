import { Show, createMemo } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { categoryPickerRows, pickerSuggestions } from "../../domain/categoryOptions"
import type { PickerItem } from "../../state/settingsForm"
import { ListPicker } from "./ListPicker"
import { categoryMark } from "../icons"
import { count } from "../text"
import { boughtText } from "../../domain/history"

/** Choose a category for the target transactions, grouped and filterable;
 * their suggested categories first. */
export function CatPicker() {
  const suggested = createMemo(() => pickerSuggestions(ui.state.pickerTargets, data.state.suggestions))
  const items = createMemo((): PickerItem[] => categoryPickerRows(data.state.categories, ui.state.catPickerQuery, true, suggested()).map((r) =>
    r.kind === "heading" ? r : { kind: "item", label: r.category.name, value: r.category.id, color: r.category.color, ...(r.confidence !== undefined ? { detail: `${Math.round(r.confidence * 100)}%` } : {}) }))
  const targets = () => ui.state.pickerTargets.length
  // Targets the table doesn't show (a selection a filter hides): said, so it's no surprise.
  const hiddenTargets = createMemo(() => {
    const shown = new Set(data.scopedTransactions().map((t) => t.id))
    return ui.state.pickerTargets.filter((id) => !shown.has(id)).length
  })
  // One row: what it bought, or the bank's message, so the choice isn't blind.
  const note = createMemo(() => {
    if (targets() !== 1) return undefined
    const t = data.transactions().find((row) => row.id === ui.state.pickerTargets[0])
    const bought = t ? boughtText(t) : ""
    return bought ? `Bought ${bought}` : t?.message ? `Message ${t.message}` : undefined
  })
  return (
    <Show when={ui.state.catPickerOpen}>
      <ListPicker
        title="Category"
        subtitle={`${count(targets(), "transaction")}${hiddenTargets() ? `, ${hiddenTargets()} not in view` : ""}`}
        items={items()}
        cursor={ui.state.catPickerCursor}
        query={ui.state.catPickerQuery}
        iconFor={(value) => categoryMark(Number(value))}
        note={note()}
        hints="↑↓ ^j/k move · enter apply · esc cancel"
      />
    </Show>
  )
}
