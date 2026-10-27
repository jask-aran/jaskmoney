import { Show, createMemo } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { tagPickerItems, tagPickerState } from "../../state/tagPicker"
import { ListPicker } from "./ListPicker"
import { count } from "../text"

export function TagPicker() {
  const items = createMemo(() => tagPickerItems(data.state.tags, data.transactions(), ui.state.pickerTargets, ui.state.tagPickerQuery))
  const mark = (value: string | number | null) => {
    // The create row: a plus in the checkbox column.
    if (value === null) return " + "
    const id = Number(value)
    const patch = ui.state.tagPickerPatch[id]
    const state = patch === "add" ? "all" : patch === "remove" ? "none"
      : tagPickerState(data.transactions(), ui.state.pickerTargets, id)
    return state === "all" ? "[x]" : state === "some" ? "[-]" : "[ ]"
  }
  return (
    <Show when={ui.state.tagPickerOpen}>
      <ListPicker
        title="Tags"
        subtitle={count(ui.state.pickerTargets.length, "transaction")}
        items={items()}
        cursor={ui.state.tagPickerCursor}
        query={ui.state.tagPickerQuery}
        mark={mark}
        hints="↑↓ ^j/k move · space stage · enter apply · esc cancel"
      />
    </Show>
  )
}
