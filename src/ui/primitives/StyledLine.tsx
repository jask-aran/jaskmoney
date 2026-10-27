import { RGBA, StyledText, TextAttributes, type TextChunk, type TextRenderable } from "@opentui/core"
import { createEffect } from "solid-js"

/** A run of a styled line: text and how it looks (no colour: the text's default). */
export interface StyledSpan { text: string; fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean }

/**
 * One line of styled runs as a single text element: the runs become a
 * StyledText set on the node, so a line of many colours is one element and
 * one update, not an <S> (a node with two effects) per run. Each run sets
 * its whole style, so a run that loses bold or a colour loses it (proved in
 * ChartBody.test and the table's captured-cell tests). Set on the node:
 * Solid's `content` prop would stringify a StyledText. `bg` fills the line
 * past its runs.
 */
export function StyledLine(props: { spans: StyledSpan[]; bg?: string }) {
  return (
    <text wrapMode="none" width="100%" ref={(node: TextRenderable) => {
      let bg: string | undefined
      let first = true
      createEffect(() => {
        node.content = styledText(props.spans)
        if (first || props.bg !== bg) node.bg = bg = props.bg
        first = false
      })
    }} />
  )
}

export function styledText(spans: StyledSpan[]): StyledText {
  return new StyledText(spans.map((span): TextChunk => ({
    __isChunk: true,
    text: span.text,
    ...(span.fg ? { fg: rgba(span.fg) } : {}),
    ...(span.bg ? { bg: rgba(span.bg) } : {}),
    attributes: (span.bold ? TextAttributes.BOLD : 0) | (span.dim ? TextAttributes.DIM : 0) | (span.italic ? TextAttributes.ITALIC : 0),
  })))
}

const colours = new Map<string, RGBA>()
/** A colour parsed once. */
function rgba(hex: string): RGBA {
  let colour = colours.get(hex)
  if (!colour) colours.set(hex, colour = RGBA.fromHex(hex))
  return colour
}
