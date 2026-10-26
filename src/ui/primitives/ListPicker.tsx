import { For, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { theme } from "../../theme"
import type { PickerItem } from "../../state/settingsForm"
import { fit } from "../text"
import { Modal } from "./Modal"
import { S } from "./S"
import { ListRow, centredTop } from "./ListRow"

/**
 * A filterable list in a Modal: the filter line, then group headings and
 * items, scrolled so the cursor (an index into the items, headings skipped)
 * stays in view. An item's `detail` follows its label, muted. `mark` adds a
 * checkbox ("[x]", "[-]", "[ ]") per item for multi-choice lists.
 */
export function ListPicker(props: {
  title: string
  subtitle?: string
  items: PickerItem[]
  cursor: number
  query: string
  hints: string
  width?: number
  mark?: (value: string | number | null) => string
  /** A marker (e.g. a category icon) before each item's label. */
  iconFor?: (value: string | number | null) => string | undefined
}) {
  const dims = useTerminalDimensions()
  // Wide enough for the hint line (border and padding: 4).
  const width = () => Math.max(20, Math.min(Math.max(props.width ?? 52, props.hints.length + 4), dims().width - 4))
  // Modal chrome: border (2, the title in it), filter + blank, blank +
  // hints, and a margin of 4.
  const visible = () => Math.max(4, Math.min(props.items.length, dims().height - 10))
  const cursorRow = createMemo(() => {
    let seen = -1
    return props.items.findIndex((item) => item.kind === "item" && ++seen === props.cursor)
  })
  const top = createMemo(() => centredTop(Math.max(0, cursorRow()), props.items.length, visible()))
  const rows = () => props.items.slice(top(), top() + visible()).map((item, i) => ({ item, row: top() + i }))
  return (
    <Modal title={props.title} subtitle={props.subtitle} width={width()} hints={props.hints}>
      <text wrapMode="none">
        <S fg={theme.subtext0}>{"Filter "}</S>
        <S fg={props.query ? theme.text : theme.overlay0}>{props.query || "type to filter"}</S>
      </text>
      <text> </text>
      <For each={rows()}>
        {({ item, row }) => {
          if (item.kind === "heading") return <text fg={theme.overlay1} wrapMode="none"><b>{item.label}</b></text>
          const selected = () => row === cursorRow()
          const icon = () => props.iconFor?.(item.value)
          return (
            <ListRow cursor={selected()} bg={theme.mantle} spans={[
              ...(props.mark ? [{ text: `${props.mark(item.value)} `, fg: theme.subtext0 }] : []),
              ...(icon() ? [{ text: `${icon()} `, fg: item.color ?? theme.text }] : []),
              { text: item.detail ? item.label : fit(item.label, width() - 12), fg: item.color ?? theme.text, bold: selected() },
              ...(item.detail ? [{ text: fit(`  ${item.detail}`, Math.max(0, width() - 12 - item.label.length)), fg: theme.overlay1 }] : []),
            ]} />
          )
        }}
      </For>
      <Show when={!props.items.some((i) => i.kind === "item")}>
        <text fg={theme.overlay1}>Nothing matches</text>
      </Show>
    </Modal>
  )
}
