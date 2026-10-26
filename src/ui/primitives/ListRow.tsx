import { Index } from "solid-js"
import { theme } from "../../theme"
import type { Span } from "./spans"
import { S } from "./S"

/**
 * One row of a list, in a pane or a dialog: the cursor marker (the Go app's
 * "> ", bold accent), then the row's spans, every cell on one background:
 * the cursor's, else the list's own (`bg`: canvas in a pane, mantle in a
 * dialog). Clipped at the end rather than wrapped.
 */
export function ListRow(props: { cursor: boolean; bg: string; spans: Span[] }) {
  const bg = () => (props.cursor ? theme.surface0 : props.bg)
  return (
    <box width="100%" height={1} overflow="hidden">
      <text bg={bg()} wrapMode="none">
        <S fg={theme.accent} bg={bg()} bold>{props.cursor ? "> " : "  "}</S>
        <Index each={props.spans}>{(span) => <S fg={span().fg} bg={bg()} bold={span().bold}>{span().text}</S>}</Index>
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
