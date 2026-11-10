import type { BoxRenderable } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { Show, createSignal, Index } from "solid-js"
import { theme, tone } from "../../theme"
import { fitSpans, spansWidth, type Span } from "./spans"
import { S } from "./S"

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

/** Where an inset card's title starts (its leading space; the words one
 * further): the content's column plus one, so the title sits clearly in
 * from the text below rather than nearly level with it. */
const TITLE_INSET = 2

export function SectionCard(props: {
  title: string
  focused?: boolean
  active?: boolean
  titleSuffix?: string
  titleSuffixColor?: string
  flexGrow?: number
  height?: number | "auto" | `${number}%`
  width?: number | "auto" | `${number}%`
  /** Coloured spans at the right of the top border. */
  titleRight?: Span[]
  /** End the right spans on the content's last column (column headings over
   * right-aligned figures) instead of a space before the corner. */
  titleRightFlush?: boolean
  /** Coloured spans in the bottom border. */
  bottomSpans?: Span[]
  /** The inset layout (Settings): no padding, every line bringing its own
   * one-cell inset (ListRow, PaneLine), so all of a card's text starts one
   * cell from its border and a cursor's wash runs border to border; the
   * title stands TITLE_INSET cells further in than the content. */
  inset?: boolean
  children?: JSX.Element
}) {
  // Until the first layout reports a size, start from the given one.
  const [width, setWidth] = createSignal(typeof props.width === "number" ? props.width : 0)
  const [height, setHeight] = createSignal(typeof props.height === "number" ? props.height : 0)
  const borderColor = () => (props.focused ? tone.focus : theme.surface1)
  const titleColor = () => (props.focused ? tone.focus : tone.key)
  // Border text: `╭─` before the title and `─╮` after the right spans; a
  // space either side of each. Until the first layout reports a width, the
  // title is shown in full.
  const titleLeft = () => (props.inset ? TITLE_INSET : 1)
  const space = (): Span => ({ text: " ", fg: borderColor() })
  const title = () => {
    const spans: Span[] = [
      { text: ` ${props.title}`, fg: titleColor(), bold: true },
      ...(props.titleSuffix ? [{ text: ` ${props.titleSuffix}`, fg: props.titleSuffixColor ?? titleColor(), bold: true }] : []),
      ...(props.active ? [{ text: " *", fg: titleColor(), bold: true }] : []),
    ]
    return [...(width() > 0 ? fitSpans(spans, Math.max(0, width() - 4 - titleLeft())) : spans), space()]
  }
  const right = () => {
    const spans = width() > 0 && props.titleRight ? fitSpans(props.titleRight, Math.max(0, width() - 8 - spansWidth(title()))) : []
    return spans.length ? [space(), ...spans, ...(props.titleRightFlush ? [] : [space()])] : []
  }
  const bottom = () => {
    const spans = width() > 0 && height() > 1 && props.bottomSpans ? fitSpans(props.bottomSpans, Math.max(0, width() - 6)) : []
    return spans.length ? [space(), ...spans, space()] : []
  }

  return (
    <box
      ref={(box: BoxRenderable) => {
        box.onSizeChange = () => { setWidth(box.width); setHeight(box.height) }
      }}
      border
      borderStyle="rounded"
      borderColor={borderColor()}
      flexGrow={props.flexGrow ?? 0}
      height={props.height}
      width={props.width ?? "100%"}
      paddingLeft={props.inset ? 0 : 1}
      paddingRight={props.inset ? 0 : 1}
      backgroundColor={theme.canvas}
    >
      <BorderText spans={title()} top={-1} left={titleLeft()} bg={theme.canvas} />
      {props.children}
      <Show when={props.titleRight}>
        <BorderText spans={right()} top={-1} left={width() - 3 - spansWidth(right())} bg={theme.canvas} />
      </Show>
      <Show when={props.bottomSpans}>
        <BorderText spans={bottom()} top={height() - 2} left={1} bg={theme.canvas} />
      </Show>
    </box>
  )
}
