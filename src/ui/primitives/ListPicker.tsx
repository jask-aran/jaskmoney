import { For, Show, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { theme } from "../../theme"
import type { PickerItem } from "../../state/settingsForm"
import { fit } from "../text"
import { Modal } from "./Modal"
import { S } from "./S"

/**
 * A filterable list in a Modal: the filter line, then group headings and
 * items, scrolled so the cursor (an index into the items, headings skipped)
 * stays in view. `mark` adds a checkbox ("[x]", "[-]", "[ ]") per item for
 * multi-choice lists.
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
  const width = () => Math.max(20, Math.min(props.width ?? 52, dims().width - 4))
  // Modal chrome: border (2), padding (2), title + blank, filter + blank,
  // blank + hints.
  const visible = () => Math.max(4, Math.min(props.items.length, dims().height - 14))
  const cursorRow = createMemo(() => {
    let seen = -1
    return props.items.findIndex((item) => item.kind === "item" && ++seen === props.cursor)
  })
  const top = createMemo(() => Math.max(0, Math.min(props.items.length - visible(), Math.max(0, cursorRow()) - Math.floor(visible() / 2))))
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
          const bg = () => (selected() ? theme.surface0 : theme.mantle)
          return (
            <text bg={bg()} wrapMode="none">
              <S fg={theme.accent} bg={bg()} bold>{selected() ? "› " : "  "}</S>
              <Show when={props.mark}>
                <S fg={theme.subtext0} bg={bg()}>{`${props.mark!(item.value)} `}</S>
              </Show>
              <Show when={props.iconFor?.(item.value)}>
                {(icon: () => string) => <S fg={item.color ?? theme.text} bg={bg()}>{`${icon()} `}</S>}
              </Show>
              <S fg={item.color ?? theme.text} bg={bg()} bold={selected()}>{fit(item.label, width() - 12)}</S>
            </text>
          )
        }}
      </For>
      <Show when={!props.items.some((i) => i.kind === "item")}>
        <text fg={theme.overlay1}>Nothing matches</text>
      </Show>
    </Modal>
  )
}
