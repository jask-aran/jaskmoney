import { Show, createMemo } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { tagPickerItems, tagPickerState } from "../../state/tagPicker"
import { ListPicker } from "./ListPicker"
import { count } from "../text"

export function TagPicker() {
  return <Show when={ui.state.tagPicker !== null}><OpenTagPicker /></Show>
}

/** The open picker: its rows (with counts over every row) are made only
 * while it shows. */
function OpenTagPicker() {
  const items = createMemo(() => tagPickerItems(data.state.tags, data.state.categories, data.transactions(), ui.state.pickerTargets, ui.state.tagPicker?.query ?? ""))
  const mark = (value: string | number | null) => {
    // The create row: a plus in the checkbox column.
    if (value === null) return " + "
    const id = Number(value)
    const patch = ui.state.tagPicker!.patch[id]
    const state = patch === "add" ? "all" : patch === "remove" ? "none"
      : tagPickerState(data.transactions(), ui.state.pickerTargets, id)
    return state === "all" ? "[x]" : state === "some" ? "[-]" : "[ ]"
  }
  return (
      <ListPicker
        title="Tags"
        subtitle={count(ui.state.pickerTargets.length, "transaction")}
        items={items()}
        cursor={ui.state.tagPicker!.cursor}
        query={ui.state.tagPicker!.query}
        mark={mark}
        hints="↑↓ ^j/k move · space stage · enter apply · esc cancel"
      />
  )
}
