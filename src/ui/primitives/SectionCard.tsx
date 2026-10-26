import type { BoxRenderable } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import { createSignal } from "solid-js"
import { theme } from "../../theme"
import { S } from "./S"

export interface Span {
  text: string
  fg: string
  bold?: boolean
}

/** Cut `spans` to `budget` cells, ending the cut one with an ellipsis. */
export function fitSpans(spans: Span[], budget: number): Span[] {
  const out: Span[] = []
  let left = budget
  for (const span of spans) {
    const w = Bun.stringWidth(span.text)
    if (w <= left) { out.push(span); left -= w; continue }
    if (left > 1) out.push({ ...span, text: [...span.text].slice(0, left - 1).join("") + "…" })
    break
  }
  return out
}

/** Fit title segments into `budget` cells, cutting the overflowing segment
 * with an ellipsis and dropping the rest (Go: title truncated to innerWidth). */
export function fitTitle(segments: string[], budget: number): string[] {
  const out: string[] = []
  let left = budget
  for (const seg of segments) {
    if (seg.length <= left) {
      out.push(seg)
      left -= seg.length
      continue
    }
    out.push(left > 1 ? `${seg.slice(0, left - 1)}…` : "")
    left = 0
  }
  while (out.length < segments.length) out.push("")
  return out
}

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
  bottomTitle?: string
  /** Coloured spans at the right of the top border. */
  titleRight?: Span[]
  /** Coloured spans in the bottom border (instead of `bottomTitle`). */
  bottomSpans?: Span[]
  children?: JSX.Element
}) {
  const [width, setWidth] = createSignal(0)
  const [height, setHeight] = createSignal(0)
  const borderColor = () => (props.focused ? theme.focus : theme.surface1)
  const titleColor = () => (props.focused ? theme.focus : theme.brand)
  // `╭─` before the title and `─╮` after it leave width - 4 cells, one of
  // which is the closing space. Until the first layout reports a width,
  // render the full title.
  const parts = () => {
    const segments = [
      ` ${props.title}`,
      props.titleSuffix ? ` ${props.titleSuffix}` : "",
      props.active ? " *" : "",
    ]
    const fitted = width() > 0 ? fitTitle(segments, Math.max(0, width() - 5)) : segments
    return [fitted[0]!, fitted[1]!, `${fitted[2]!} `]
  }
  const nativeTitleGap = () => parts().join("").replace(/[^\n]/g, " ")

  return (
    <box
      ref={(box: BoxRenderable) => {
        box.onSizeChange = () => { setWidth(box.width); setHeight(box.height) }
      }}
      border
      borderStyle="rounded"
      borderColor={borderColor()}
      // The native title reserves the correct gap in the border, but cannot
      // apply attributes. A bold overlay below is the app-wide title treatment.
      title={nativeTitleGap()}
      titleColor={titleColor()}
      titleAlignment="left"
      bottomTitle={props.bottomTitle}
      bottomTitleAlignment="left"
      flexGrow={props.flexGrow ?? 0}
      height={props.height}
      width={props.width ?? "100%"}
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={theme.canvas}
    >
      {/* left=1: absolute children are placed from the border's inner edge
          (column 1), but the native title gap starts at column 2. */}
      <text position="absolute" top={-1} left={1} zIndex={1} height={1} wrapMode="none">
        <S fg={titleColor()} bold>
          {parts()[0]}
        </S>
        <S fg={props.titleSuffixColor ?? titleColor()} bold>
          {parts()[1]}
        </S>
        <S fg={titleColor()} bold>
          {parts()[2]}
        </S>
      </text>
      {props.children}
      {/* Border spans: a space either side, over the border line. Every span
          paints the canvas background, or its spaces would show the border. */}
      {props.titleRight?.length && width() > 0 ? (() => {
        const spans = fitSpans(props.titleRight!, Math.max(0, width() - 8 - Bun.stringWidth(parts().join(""))))
        const w = spans.reduce((n, sp) => n + Bun.stringWidth(sp.text), 0)
        return w > 0 ? (
          <text position="absolute" top={-1} left={width() - 5 - w} zIndex={1} height={1} wrapMode="none">
            <S fg={borderColor()} bg={theme.canvas}>{" "}</S>
            {spans.map((sp) => <S fg={sp.fg} bg={theme.canvas} bold={sp.bold}>{sp.text}</S>)}
            <S fg={borderColor()} bg={theme.canvas}>{" "}</S>
          </text>
        ) : null
      })() : null}
      {props.bottomSpans?.length && height() > 1 ? (
        <text position="absolute" top={height() - 2} left={1} zIndex={1} height={1} wrapMode="none">
          <S fg={borderColor()} bg={theme.canvas}>{" "}</S>
          {fitSpans(props.bottomSpans!, Math.max(0, width() - 6)).map((sp) => <S fg={sp.fg} bg={theme.canvas} bold={sp.bold}>{sp.text}</S>)}
          <S fg={borderColor()} bg={theme.canvas}>{" "}</S>
        </text>
      ) : null}
    </box>
  )
}
