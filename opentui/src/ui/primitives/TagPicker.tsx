import { For, Show, createMemo } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { S } from "./S"

function selectedOrCursorIds(): number[] {
  const rows = data.scopedTransactions()
  const hl = ui.highlightedIds(rows)
  const hlIds = Object.keys(hl).map(Number)
  if (hlIds.length) return hlIds
  const sel = Object.keys(ui.state.selectedIds).map(Number)
  if (sel.length) return sel
  const row = rows[ui.state.managerCursor]
  return row ? [row.id] : []
}

export function TagPicker() {
  const filtered = createMemo(() => {
    const q = ui.state.tagPickerQuery.trim().toLowerCase()
    const tags = data.state.tags
    if (!q) return tags
    return tags.filter((t) => t.name.toLowerCase().includes(q))
  })

  const targets = createMemo(() => selectedOrCursorIds())

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
      <box
        position="absolute"
        left={0}
        top={0}
        width="100%"
        height="100%"
        justifyContent="center"
        alignItems="center"
      >
        <box
          border
          borderStyle="rounded"
          borderColor={theme.accent}
          backgroundColor={theme.mantle}
          padding={1}
          width={44}
          flexDirection="column"
        >
          <text fg={theme.accent}>
            <b>Quick Tags</b>
            <S fg={theme.overlay1}> · {targets().length} target(s)</S>
          </text>
          <text fg={theme.overlay1}>
            Filter: {ui.state.tagPickerQuery || "(type to filter)"}
          </text>
          <For each={filtered()}>
            {(tg, i) => {
              const sel = () => i() === ui.state.tagPickerCursor
              const st = () => stateFor(tg.id)
              return (
                <text bg={sel() ? theme.surface0 : undefined}>
                  <S fg={theme.accent} bold={sel()}>
                    {sel() ? "> " : "  "}
                  </S>
                  <S fg={theme.subtext1}>{mark(st())} </S>
                  <S fg={tg.color}>{tg.name}</S>
                </text>
              )
            }}
          </For>
          <text fg={theme.overlay1}>space toggle  enter done  esc cancel</text>
        </box>
      </box>
    </Show>
  )
}
