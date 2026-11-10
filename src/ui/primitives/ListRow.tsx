import type { MouseEvent } from "@opentui/core"
import { Index, createMemo } from "solid-js"
import { tone } from "../../theme"
import { rowAppearance } from "../../domain/rowStyle"
import type { Span } from "./spans"
import { S } from "./S"

/**
 * One row of a list, in a pane or a dialog: the row's spans after a
 * one-column inset, on the Transactions table's washes (rowAppearance):
 * the cursor row bold on rowCursor, a selected one on rowSelected, else the
 * list's own background (`bg`: canvas in a pane, mantle in a dialog), the
 * wash across the whole row. Clipped at the end rather than wrapped. An
 * armed row (`armed`, state/armed) says what its key does again, in red,
 * in place of its spans. `id`: for a scrolling parent to bring the row
 * into view. `onMouseDown`: a click on the row (Settings: select it).
 */
export function ListRow(props: { cursor: boolean; selected?: boolean; bg: string; spans: Span[]; armed?: string; id?: string; onMouseDown?: (event: MouseEvent) => void }) {
  // Memos: the cursor prop is often an expression over the list's window
  // and cursor, read here once per change rather than once per span.
  const look = createMemo(() => rowAppearance(!!props.selected, false, props.cursor))
  const bg = createMemo(() => look().bg ?? props.bg)
  const spans = (): Span[] => props.armed ? [{ text: props.armed, fg: tone.bad, bold: true }] : props.spans
  return (
    <box id={props.id} width="100%" height={1} overflow="hidden" backgroundColor={bg()} onMouseDown={props.onMouseDown}>
      <text bg={bg()} wrapMode="none">
        <S bg={bg()}>{" "}</S>
        <Index each={spans()}>{(span) => <S fg={look().fg ?? span().fg} bg={bg()} bold={span().bold || look().bold}>{span().text}</S>}</Index>
      </text>
    </box>
  )
}

/** The first row of a `visible`-row window over `count` rows that keeps
 * `cursor` in the middle where it can (clamped to either end). */
export function centredTop(cursor: number, count: number, visible: number): number {
  return Math.max(0, Math.min(count - visible, cursor - Math.floor(visible / 2)))
}

/** Where a window is: "4–12 of 30", or "empty". */
export function windowLabel(top: number, visible: number, count: number): string {
  return count ? `${top + 1}–${Math.min(top + visible, count)} of ${count}` : "empty"
}
