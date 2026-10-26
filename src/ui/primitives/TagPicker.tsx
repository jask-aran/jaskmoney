import { Show, createMemo } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { ListPicker } from "./ListPicker"


export function TagPicker() {
  const filtered = createMemo(() => {
    const q = ui.state.tagPickerQuery.trim().toLowerCase()
    const tags = data.state.tags
    if (!q) return tags
    return tags.filter((t) => t.name.toLowerCase().includes(q))
  })

  const targets = () => ui.state.pickerTargets

  const stateFor = (tagId: number): "all" | "some" | "none" => {
    const ids = targets()
    if (!ids.length) return "none"
    let hits = 0
    for (const id of ids) {
      const t = data.state.transactions.find((x) => x.id === id)
      if (t?.tagIds.includes(tagId)) hits++
    }
    if (hits === 0) return "none"
    if (hits === ids.length) return "all"
    return "some"
  }

  const mark = (s: "all" | "some" | "none") =>
    s === "all" ? "[x]" : s === "some" ? "[-]" : "[ ]"

  return (
    <Show when={ui.state.tagPickerOpen}>
      <ListPicker
        title="Tags"
        subtitle={`${targets().length} transaction${targets().length === 1 ? "" : "s"}`}
        items={filtered().map((t) => ({ kind: "item" as const, label: t.name, value: t.id, color: t.color }))}
        cursor={ui.state.tagPickerCursor}
        query={ui.state.tagPickerQuery}
        mark={(value) => mark(stateFor(Number(value)))}
        hints="j/k move · space toggle · enter done · esc cancel"
      />
    </Show>
  )
}
