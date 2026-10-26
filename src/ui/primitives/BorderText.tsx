import { Index } from "solid-js"
import { S } from "./S"
import type { Span } from "./spans"

/**
 * Text drawn over a bordered box's border line (titles, legends, pickers).
 * Every span paints `bg`, so its spaces cover the border. Place it as a child
 * of the box: absolute children are placed from the border's inner edge, so
 * `top={-1}` is the top border, `top={height - 2}` the bottom one, and `left`
 * counts from column 1. Spans update in place (Index), so a change never
 * shows a frame of bare border.
 */
export function BorderText(props: { spans: Span[]; top: number; left: number; bg: string }) {
  return (
    <text position="absolute" top={props.top} left={Math.max(0, props.left)} zIndex={1} height={1} wrapMode="none">
      <Index each={props.spans}>{(span) => <S fg={span().fg} bg={props.bg} bold={span().bold}>{span().text}</S>}</Index>
    </text>
  )
}
