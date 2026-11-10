import type { Run } from "./lineChart"
import type { ChartLabelMode } from "./motion"
import { ink } from "../../theme"
import type { Span } from "../primitives/spans"
import { textCells } from "./runs"

export function revealRuns(runs: Run[], row: number, rows: number, p: number, frame?: ReadonlyMap<number, Run>, bars = false, labels: ChartLabelMode = "together"): Run[] {
  if (p >= 1) return runs
  const cells: Array<{ ch: string; ink: Run["ink"] }> = []
  for (const run of runs) for (const ch of textCells(run.text)) cells.push({ ch, ink: run.ink })
  const width = cells.length
  const edge = p * width
  const risen = row >= rows - Math.ceil(p * rows)
  const kind = (ch: string): "space" | "line" | "bar" | "frame" | "word" => {
    if (ch === " ") return "space"
    if (ch === "") return "word"
    const code = ch.codePointAt(0)!
    if (code >= 0x2800 && code <= 0x28ff) return "line"
    if (code >= 0x2580 && code <= 0x259f) return "bar"
    if (code >= 0x2500 && code <= 0x257f) return "frame"
    return "word"
  }
  const labelEnd = new Array<number>(width).fill(-1)
  for (let i = 0; i < width; i++) {
    if (kind(cells[i]!.ch) !== "word") continue
    let end = i
    while (end + 1 < width && (kind(cells[end + 1]!.ch) === "word" || (cells[end + 1]!.ch === " " && end + 2 < width && kind(cells[end + 2]!.ch) === "word"))) end++
    for (let j = i; j <= end; j++) labelEnd[j] = end
    i = end
  }
  const out: Run[] = []
  const put = (ch: string, ink: Run["ink"]) => {
    const last = out.at(-1)
    if (last && last.ink === ink) last.text += ch
    else out.push({ text: ch, ink })
  }
  cells.forEach(({ ch, ink }, col) => {
    let shown: boolean
    if (labelEnd[col]! >= 0) shown = labels === "together" ? p >= LABELS_TOGETHER_AT : edge >= labelEnd[col]! + LABEL_LAG && (!bars || risen)
    else {
      const k = kind(ch)
      shown = k === "space" || k === "frame" || (k === "line" ? col < edge : risen)
    }
    const under = frame?.get(col)
    if (shown) { if (ch) put(ch, ink) }
    else if (under) put(under.text, under.ink)
    else put(" ", ink)
  })
  return out
}

const LABELS_TOGETHER_AT = 0.85

const LABEL_LAG = 1.5

export function gridColumns(rows: Run[][]): Map<number, Run> {
  const found = new Map<number, Run>()
  for (const runs of rows) {
    let col = 0
    for (const run of runs) for (const ch of textCells(run.text)) {
      if (!found.has(col) && (ch === "│" || ch === "┊" || ch === "┆" || ch === "╎")) found.set(col, { text: ch, ink: run.ink })
      col++
    }
  }
  return found
}

export function hasBars(rows: Run[][]): boolean {
  return rows.some((runs) => runs.some((run) => /[▀-▟]/.test(run.text)))
}

export function hasMarks(rows: Run[][]): boolean {
  return rows.some((runs) => runs.some((run) => /[\u2801-\u28ff▀-▟]/.test(run.text)))
}

export const easeOut = (t: number, power = 3) => 1 - (1 - Math.min(1, Math.max(0, t))) ** power

export interface TopLine { spans: Span[]; bg?: string; sweeps?: boolean; stays?: boolean }

export function sweptIn(spans: Span[], p: number, width: number): Span[] {
  if (p >= 1) return spans
  const out: Span[] = []
  let left = Math.round(Math.min(1, p / 0.7) * width), total = 0
  for (const span of spans) {
    total += span.text.length
    if (left <= 0) continue
    out.push(span.text.length <= left ? span : { ...span, text: span.text.slice(0, left) })
    left -= span.text.length
  }
  const shown = out.reduce((n, x) => n + x.text.length, 0)
  return [...out, { text: " ".repeat(Math.max(0, total - shown)), fg: ink.note }]
}

export function revealLines(lines: TopLine[], p: number, width: number): TopLine[] {
  if (p >= 1) return lines
  return lines.map((line, i) => {
    if (line.stays) return line
    if (line.sweeps) return { ...line, spans: sweptIn(line.spans, p, width) }
    return p >= 0.3 + 0.6 * (i / lines.length) ? line : { ...line, spans: [{ text: " ", fg: ink.note }] }
  })
}
