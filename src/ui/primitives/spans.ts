import { truncate } from "../text"
import { ink } from "../../theme"

export interface Span {
  text: string
  fg: string
  bold?: boolean
  bg?: string
}

export const muted = (text: string): Span => ({ text, fg: ink.note })

export function spansWidth(spans: Span[]): number {
  return spans.reduce((n, span) => n + Bun.stringWidth(span.text), 0)
}

export function fitSpans(spans: Span[], budget: number): Span[] {
  const out: Span[] = []
  let left = budget
  for (const span of spans) {
    const w = Bun.stringWidth(span.text)
    if (w <= left) { out.push(span); left -= w; continue }
    if (left > 0) out.push({ ...span, text: truncate(span.text, left) })
    break
  }
  return out
}

export function padSpans(spans: Span[], width: number): Span[] {
  const fitted = fitSpans(spans, width)
  const used = spansWidth(fitted)
  return used < width ? [...fitted, muted(" ".repeat(width - used))] : fitted
}
