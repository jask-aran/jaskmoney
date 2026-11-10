/** @jsxImportSource @opentui/solid */
import { RGBA, StyledText, TextAttributes, type TextChunk, type TextRenderable } from "@opentui/core"
import { createEffect } from "solid-js"

export interface StyledSpan { text: string; fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean }

export function StyledLine(props: { spans: StyledSpan[]; bg?: string }) {
  return (
    <text wrapMode="none" width="100%" ref={(node: TextRenderable) => {
      let bg: string | undefined
      let first = true
      let was: StyledSpan[] | undefined
      createEffect(() => {
        const spans = props.spans
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

function styledText(spans: StyledSpan[]): StyledText {
  return new StyledText(spans.map((span): TextChunk => ({
    __isChunk: true,
    text: span.text,
    ...(span.fg ? { fg: rgba(span.fg) } : {}),
    ...(span.bg ? { bg: rgba(span.bg) } : {}),
    attributes: (span.bold ? TextAttributes.BOLD : 0) | (span.dim ? TextAttributes.DIM : 0) | (span.italic ? TextAttributes.ITALIC : 0),
  })))
}

const colours = new Map<string, RGBA>()
function rgba(hex: string): RGBA {
  let colour = colours.get(hex)
  if (!colour) colours.set(hex, colour = RGBA.fromHex(hex))
  return colour
}
