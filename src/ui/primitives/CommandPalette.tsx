import { For, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { theme } from "../../theme"
import { fit, truncate } from "../text"
import { ListRow, centredTop } from "./ListRow"
import { Modal } from "./Modal"
import { S } from "./S"

export interface PaletteCommand { id: string; label: string; description?: string; key?: { hint: string }; group: "here" | "everywhere"; disabled?: string }

const KEY_COLUMN = 8

/**
 * ctrl+k (app/commands): a row per command, its label then its description
 * (muted) and its key in a column at the right; one that can't run now is
 * dimmed with the reason in place of its description. With nothing typed
 * the list is grouped: the last used, this pane's, everywhere's, and those
 * that can't run now.
 */
export function CommandPalette(props: { commands: PaletteCommand[]; cursor: number; query: string; from: string; lastId?: string | null }) {
  const dims = useTerminalDimensions()
  const width = () => Math.max(40, Math.min(88, dims().width - 4))
  // Border and padding (4), the cursor marker (2), the key column.
  const text = () => width() - 6 - KEY_COLUMN
  const heading = (command: PaletteCommand) =>
    command.disabled ? "Can't run now" : command.id === props.lastId ? "Last used" : command.group === "here" ? props.from : "Everywhere"
  const lines = createMemo(() => {
    const out: ({ kind: "heading"; label: string } | { kind: "command"; command: PaletteCommand; index: number })[] = []
    let last = ""
    props.commands.forEach((command, index) => {
      if (!props.query.trim()) {
        const label = heading(command)
        if (label !== last) { out.push({ kind: "heading", label }); last = label }
      }
      out.push({ kind: "command", command, index })
    })
    return out
  })
  // Chrome: border (2), the filter and a blank, a blank and the hints, a margin of 4.
  const visible = () => Math.max(4, Math.min(lines().length, dims().height - 10))
  const cursorLine = () => Math.max(0, lines().findIndex((line) => line.kind === "command" && line.index === props.cursor))
  const top = () => centredTop(cursorLine(), lines().length, visible())
  return (
    <Modal title="Commands" subtitle={props.from} width={width()} hints="↑↓ ^j/k move · enter run · esc close · type filter">
      <text wrapMode="none">
        <S fg={theme.subtext0}>{"Filter "}</S>
        <S fg={props.query ? theme.text : theme.overlay0}>{props.query || "type to filter"}</S>
      </text>
      <text> </text>
      <For each={lines().slice(top(), top() + visible())}>{(line) => {
        if (line.kind === "heading") return <text fg={theme.overlay1} wrapMode="none"><b>{line.label}</b></text>
        const command = line.command
        const at = () => line.index === props.cursor
        const detail = () => command.disabled ? `${command.disabled}` : command.description ?? ""
        const label = () => truncate(command.label, text())
        return <ListRow cursor={at()} bg={theme.mantle} spans={[
          { text: label(), fg: command.disabled ? theme.overlay0 : theme.text, bold: at() },
          { text: fit(detail() ? `  ${detail()}` : "", Math.max(0, text() - label().length)), fg: command.disabled ? theme.overlay0 : theme.overlay1 },
          { text: (command.key?.hint ?? "").padStart(KEY_COLUMN), fg: command.disabled ? theme.overlay0 : theme.accent },
        ]} />
      }}</For>
      <Show when={!props.commands.length}>
        <text fg={theme.overlay1}>No matching commands</text>
      </Show>
    </Modal>
  )
}
