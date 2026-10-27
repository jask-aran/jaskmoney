import { theme } from "../../theme"

/** A run of text in one colour: titles, legends and other styled one-liners. */
export interface Span {
  text: string
  fg: string
  bold?: boolean
}

export const muted = (text: string): Span => ({ text, fg: theme.overlay1 })

/** Total display width of `spans`. */
export function spansWidth(spans: Span[]): number {
  return spans.reduce((n, span) => n + Bun.stringWidth(span.text), 0)
}

/** Cut `spans` to `budget` cells, ending the cut one with an ellipsis and
 * dropping the rest. */
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

/** Clip spans and fill the remaining cells with muted spaces. */
export function padSpans(spans: Span[], width: number): Span[] {
  const fitted = fitSpans(spans, width)
  const used = spansWidth(fitted)
  return used < width ? [...fitted, muted(" ".repeat(width - used))] : fitted
}
