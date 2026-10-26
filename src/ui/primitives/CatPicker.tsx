import { For, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { categoryPickerRows } from "../../domain/categoryOptions"
import { S } from "./S"

/** Category picker: groups as headings, assignable categories beneath,
 * scrolled to keep the cursor in view. */
export function CatPicker() {
  const dims = useTerminalDimensions()
  const rows = createMemo(() => categoryPickerRows(data.state.categories, ui.state.catPickerQuery))
  // Border (2), padding (2), title, filter line, footer and two spacers.
  const visible = () => Math.max(4, Math.min(rows().length, dims().height - 14))
  const cursorRow = () => rows().findIndex((r) => r.kind === "category" && r.index === ui.state.catPickerCursor)
  const top = createMemo(() => {
    const n = visible()
    const c = Math.max(0, cursorRow())
    // Keep the cursor's group heading visible when possible.
    return Math.max(0, Math.min(rows().length - n, c - Math.floor(n / 2)))
  })
  const windowRows = () => rows().slice(top(), top() + visible())

  return (
    <Show when={ui.state.catPickerOpen}>
      <box position="absolute" left={0} top={0} width="100%" height="100%" justifyContent="center" alignItems="center">
        <box border borderStyle="rounded" borderColor={theme.accent} backgroundColor={theme.mantle} padding={1} width={48} flexDirection="column">
          <text fg={theme.accent}>
            <b>Category</b>
          </text>
          <text fg={theme.overlay1}>{`Filter: ${ui.state.catPickerQuery || "(type to filter)"}`}</text>
          <text> </text>
          <For each={windowRows()}>
            {(row) => {
              if (row.kind === "heading") return <text fg={theme.overlay1} wrapMode="none"><b>{row.label}</b></text>
              const sel = () => row.index === ui.state.catPickerCursor
              return (
                <text bg={sel() ? theme.accent : theme.mantle} wrapMode="none">
                  <S fg={sel() ? theme.base : theme.accent} bg={sel() ? theme.accent : theme.mantle}>{sel() ? "> " : "  "}</S>
                  <S fg={sel() ? theme.base : row.category.color} bg={sel() ? theme.accent : theme.mantle}>{row.category.name}</S>
                </text>
              )
            }}
          </For>
          <Show when={rows().length === 0}>
            <text fg={theme.overlay1}>No matching categories</text>
          </Show>
          <text> </text>
          <text fg={theme.overlay1}>j/k move  enter apply  esc cancel</text>
        </box>
      </box>
    </Show>
  )
}
