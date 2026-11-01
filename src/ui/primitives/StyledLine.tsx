/** @jsxImportSource @opentui/solid */
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
      let was: StyledSpan[] | undefined
      createEffect(() => {
        const spans = props.spans
        // The same runs again (a parent re-ran, nothing here changed):
        // leave the node alone rather than restyle it natively.
        if (first || !sameSpans(was!, spans)) node.content = styledText(spans)
        was = spans
        if (first || props.bg !== bg) node.bg = bg = props.bg
        first = false
      })
    }} />
  )
}

function sameSpans(a: StyledSpan[], b: StyledSpan[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!
    if (x.text !== y.text || x.fg !== y.fg || x.bg !== y.bg || !x.bold !== !y.bold || !x.dim !== !y.dim || !x.italic !== !y.italic) return false
  }
  return true
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
