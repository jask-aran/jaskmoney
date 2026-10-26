import type { BoxRenderable } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { Show, createSignal } from "solid-js"
import { theme } from "../../theme"
import { BorderText } from "./BorderText"
import { fitSpans, spansWidth, type Span } from "./spans"

/**
 * Matches Go renderManagerSectionBox:
 * - default title = brand pink bold; border = surface1
 * - focused = lavender title + border
 * - active adds " *" suffix (Go isActive)
 */
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
  /** Coloured spans in the bottom border. */
  bottomSpans?: Span[]
  children?: JSX.Element
}) {
  // Until the first layout reports a size, start from the given one.
  const [width, setWidth] = createSignal(typeof props.width === "number" ? props.width : 0)
  const [height, setHeight] = createSignal(typeof props.height === "number" ? props.height : 0)
  const borderColor = () => (props.focused ? theme.focus : theme.surface1)
  const titleColor = () => (props.focused ? theme.focus : theme.brand)
  // Border text: `╭─` before the title and `─╮` after the right spans; a
  // space either side of each. Until the first layout reports a width, the
  // title is shown in full.
  const space = (): Span => ({ text: " ", fg: borderColor() })
  const title = () => {
    const spans: Span[] = [
      { text: ` ${props.title}`, fg: titleColor(), bold: true },
      ...(props.titleSuffix ? [{ text: ` ${props.titleSuffix}`, fg: props.titleSuffixColor ?? titleColor(), bold: true }] : []),
      ...(props.active ? [{ text: " *", fg: titleColor(), bold: true }] : []),
    ]
    return [...(width() > 0 ? fitSpans(spans, Math.max(0, width() - 5)) : spans), space()]
  }
  const right = () => {
    const spans = width() > 0 && props.titleRight ? fitSpans(props.titleRight, Math.max(0, width() - 8 - spansWidth(title()))) : []
    return spans.length ? [space(), ...spans, space()] : []
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
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.canvas}
    >
      <BorderText spans={title()} top={-1} left={1} bg={theme.canvas} />
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
