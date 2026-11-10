import { RGBA } from "@opentui/core"
import { For, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import type { Command } from "../../app/commands"
import { theme, ink, tone } from "../../theme"
import { fit, truncate } from "../text"
import { S } from "./S"
import { TextInput } from "./TextInput"

/** A window measured in cells, with its cursor entry fully visible.
 * An entry taller than rows gets its own window. End is exclusive. */
function visibleWindow(heights: readonly number[], cursor: number, rows: number): { start: number; end: number } {
  if (!heights.length) return { start: 0, end: 0 }
  const at = Math.max(0, Math.min(heights.length - 1, cursor))
  const capacity = Math.max(1, rows, heights[at]!)
  let start = at, end = at + 1, used = heights[at]!
  let before = 0
  while (start > 0 && before + heights[start - 1]! <= Math.floor(capacity / 2) && used + heights[start - 1]! <= capacity) {
    before += heights[--start]!
    used += heights[start]!
  }
  while (end < heights.length && used + heights[end]! <= capacity) used += heights[end++]!
  while (start > 0 && used + heights[start - 1]! <= capacity) used += heights[--start]!
  return { start, end }
}

const WIDTH = 64
const INSET = 2
const BACKDROP = RGBA.fromInts(0, 0, 0, 150)

type Line = { kind: "heading"; label: string; first: boolean } | { kind: "command"; command: Command; index: number }

/**
 * ctrl+k (app/commands), after opencode's command dialog: a borderless panel
 * over a dimmed screen, a quarter of the way down. The search is its top
 * line (esc at the right). Nothing typed: the commands grouped under bold
 * headings (the last used, this pane's, then the rest); typed: one ranked
 * list, each row naming its group. A row is its label, a short muted
 * description, and its key at the right; the cursor's row is a solid
 * accent bar. The list takes at most half the screen, "…" when there's more.
 */
export function CommandPalette(props: { commands: Command[]; cursor: number; query: string; lastId: string | null }) {
  const dims = useTerminalDimensions()
  const width = () => Math.min(WIDTH, dims().width - 2)
  const inner = () => width() - INSET * 2
  // Memos, so a cursor move (a new palette state) doesn't rebuild the rows.
  const searching = createMemo(() => !!props.query.trim())
  const lines = createMemo(() => {
    const out: Line[] = []
    let group = ""
    props.commands.forEach((command, index) => {
      if (!searching()) {
        const label = index === 0 && command.id === props.lastId ? "Last used" : command.category
        if (label !== group) { out.push({ kind: "heading", label, first: !out.length }); group = label }
      }
      out.push({ kind: "command", command, index })
    })
    return out
  })
  // A heading after the first takes a blank line above it.
  const height = (line: Line) => line.kind === "heading" && !line.first ? 2 : 1
  const limit = () => Math.max(6, Math.floor(dims().height / 2) - 4)
  const cursorLine = () => Math.max(0, lines().findIndex((line) => line.kind === "command" && line.index === props.cursor))
  const window = () => visibleWindow(lines().map(height), cursorLine(), limit())
  const shown = () => lines().slice(window().start, window().end)
  const more = () => window().end < lines().length
  return (
    <box position="absolute" zIndex={30} left={0} top={0} width="100%" height="100%" backgroundColor={BACKDROP} alignItems="center" paddingTop={Math.floor(dims().height / 4)}>
      <box width={width()} backgroundColor={theme.mantle} paddingTop={1} paddingBottom={1} flexDirection="column">
        <box paddingLeft={INSET} paddingRight={INSET} flexDirection="row" justifyContent="space-between">
          <text wrapMode="none"><TextInput field={{ value: props.query, caret: props.query.length }} focused /><Show when={!props.query}><S fg={ink.faint}>{"Search commands"}</S></Show></text>
          <text fg={tone.key}>esc</text>
        </box>
        <text> </text>
        <For each={shown()}>{(line) => {
          if (line.kind === "heading") return (
            <box paddingLeft={INSET} paddingTop={line.first ? 0 : 1}>
              <text fg={ink.heading} wrapMode="none"><b>{line.label}</b></text>
            </box>
          )
          const command = line.command
          const at = () => line.index === props.cursor
          const right = () => searching() ? [command.category, command.key].filter(Boolean).join(" · ") : command.key ?? ""
          const detail = () => command.disabled ?? command.description ?? ""
          const label = () => truncate(command.label, Math.max(8, inner() - right().length - 2))
          // The description fills what's left, a space short of the right column.
          const rest = () => Math.max(0, inner() - label().length - right().length - 1)
          const fg = () => command.disabled ? ink.faint : ink.figure
          const muted = () => command.disabled ? ink.faint : ink.note
          return (
            <box paddingLeft={INSET} paddingRight={INSET} backgroundColor={at() ? theme.rowCursor : theme.mantle}>
              <text wrapMode="none">
                <S fg={fg()} bold={at()}>{label()}</S>
                <S fg={muted()}>{fit(detail() ? ` ${detail()}` : "", rest())}</S>
                <S fg={muted()}>{` ${right()}`}</S>
              </text>
            </box>
          )
        }}</For>
        <Show when={more()}><box paddingLeft={INSET}><text fg={ink.note}>…</text></box></Show>
        <Show when={!props.commands.length}><box paddingLeft={INSET}><text fg={ink.note}>No matching commands</text></box></Show>
      </box>
    </box>
  )
}
