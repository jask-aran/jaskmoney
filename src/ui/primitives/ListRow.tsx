import type { MouseEvent } from "@opentui/core"
import { Index, createMemo } from "solid-js"
import { tone } from "../../theme"
import { rowAppearance } from "../../domain/rowStyle"
import type { Span } from "./spans"
import { S } from "./S"

export function ListRow(props: { cursor: boolean; selected?: boolean; bg: string; spans: Span[]; armed?: string; id?: string; onMouseDown?: (event: MouseEvent) => void }) {
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

export function centredTop(cursor: number, count: number, visible: number): number {
  return Math.max(0, Math.min(count - visible, cursor - Math.floor(visible / 2)))
}

export function windowLabel(top: number, visible: number, count: number): string {
  return count ? `${top + 1}–${Math.min(top + visible, count)} of ${count}` : "empty"
}
