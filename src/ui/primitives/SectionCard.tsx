import type { BoxRenderable } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { Show, createSignal, Index } from "solid-js"
import { theme, tone } from "../../theme"
import { fitSpans, spansWidth, type Span } from "./spans"
import { S } from "./S"

export function BorderText(props: { spans: Span[]; top: number; left: number; bg: string }) {
  return (
    <text position="absolute" top={props.top} left={Math.max(0, props.left)} zIndex={1} height={1} wrapMode="none">
      <Index each={props.spans}>{(span) => <S fg={span().fg} bg={props.bg} bold={span().bold}>{span().text}</S>}</Index>
    </text>
  )
}

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
  titleRight?: Span[]
  titleRightFlush?: boolean
  bottomSpans?: Span[]
  inset?: boolean
  children?: JSX.Element
}) {
  const [width, setWidth] = createSignal(typeof props.width === "number" ? props.width : 0)
  const [height, setHeight] = createSignal(typeof props.height === "number" ? props.height : 0)
  const borderColor = () => (props.focused ? tone.focus : theme.surface1)
  const titleColor = () => (props.focused ? tone.focus : tone.key)
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
