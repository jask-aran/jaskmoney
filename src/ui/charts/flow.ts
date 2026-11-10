import { fade, ink } from "../../theme"
import type { Span } from "../primitives/spans"

export const spansWidth = (spans: Span[]) => spans.reduce((n, l) => n + l.text.length, 0)

export function cellsOf(amounts: number[], width: number): number[] {
  const total = amounts.reduce((n, a) => n + Math.max(0, a), 0)
  if (total <= 0) return amounts.map(() => 0)
  let before = 0
  return amounts.map((a) => {
    const from = Math.round((before / total) * width)
    before += Math.max(0, a)
    return Math.round((before / total) * width) - from
  })
}

const HATCH = "╱"
export const hatched = (cells: number, fg: string, base: string): Span => ({ text: HATCH.repeat(cells), fg, bg: fade(base, 0.7) })

interface Label { at?: number; mid?: number; options: Span[][] }

export function labelled(width: number, labels: Label[]): Span[] {
  const taken: Array<{ from: number; to: number; spans: Span[] }> = []
  for (const label of labels) {
    for (const option of label.options) {
      const w = spansWidth(option)
      if (w > width) continue
      const want = label.at ?? Math.round((label.mid ?? 0) - w / 2)
      const from = Math.max(0, Math.min(width - w, want)), to = from + w
      if (taken.some((t) => from < t.to + 1 && t.from < to + 1)) continue
      taken.push({ from, to, spans: option })
      break
    }
  }
  const out: Span[] = []
  let col = 0
  for (const t of taken.sort((a, b) => a.from - b.from)) {
    if (t.from > col) out.push({ text: " ".repeat(t.from - col), fg: ink.note })
    out.push(...t.spans)
    col = t.to
  }
  return out.length ? out : [{ text: " ", fg: ink.note }]
}

interface PartLabel { from: number; cells: number; options: Span[][]; optional?: boolean }

const LABEL_GAP = 2

export function packLabels(width: number, parts: PartLabel[]): Span[] {
  const items = parts.filter((p) => p.cells > 0 && p.options.length > 0)
  const level = items.map(() => 0)
  const bySize = items.map((_, k) => k).sort((x, y) => items[x]!.cells - items[y]!.cells)
  const fit = (): Array<{ at: number; spans: Span[] }> | null => {
    const shown = items.map((p, k) => ({ p, spans: p.options[level[k]!] })).filter((x): x is { p: PartLabel; spans: Span[] } => x.spans != null)
      .map((x) => ({ ...x, w: spansWidth(x.spans), mid: x.p.from + x.p.cells / 2 })).sort((x, y) => x.mid - y.mid)
    const at = shown.map((x) => Math.round(x.mid - x.w / 2))
    for (let i = 0; i < shown.length; i++) at[i] = Math.max(at[i]!, 0, i > 0 ? at[i - 1]! + shown[i - 1]!.w + LABEL_GAP : 0)
    for (let i = shown.length - 1; i >= 0; i--) at[i] = Math.min(at[i]!, width - shown[i]!.w, i < shown.length - 1 ? at[i + 1]! - LABEL_GAP - shown[i]!.w : width)
    const ok = shown.every((x, i) => at[i]! >= 0 && (i === 0 || at[i]! >= at[i - 1]! + shown[i - 1]!.w + LABEL_GAP) && at[i]! < x.p.from + x.p.cells && at[i]! + x.w > x.p.from)
    return ok ? shown.map((x, i) => ({ at: at[i]!, spans: x.spans })) : null
  }
  const dropped = (k: number) => level[k]! >= items[k]!.options.length
  for (;;) {
    const placed = fit()
    if (placed) return placed.length ? labelled(width, placed.map((x) => ({ at: x.at, options: [x.spans] }))) : [{ text: " ", fg: ink.note }]
    const step = bySize.find((k) => items[k]!.optional && !dropped(k))
    if (step != null) { level[step] = items[step]!.options.length; continue }
    const shorter = bySize.find((k) => level[k]! < items[k]!.options.length - 1)
    if (shorter != null) { level[shorter]!++; continue }
    const drop = bySize.find((k) => !dropped(k))
    if (drop == null) return [{ text: " ", fg: ink.note }]
    level[drop] = items[drop]!.options.length
  }
}

export const money = (text: string, fg: string): Span => ({ text, fg, bold: true })

export interface FlowPart { amount: number; color: string; hatch?: boolean | { base: string }; label?: Span[][]; optional?: boolean }

interface FlowSpanLabel { cols: [number, number]; options: Span[][]; optional?: boolean }

export function flowBar(width: number, parts: FlowPart[], spans: FlowSpanLabel[] = []): { bar: Span[]; labels: Span[]; cells: number[]; from: (i: number) => number } {
  const cells = cellsOf(parts.map((p) => p.amount), width)
  const from = (i: number) => cells.slice(0, i).reduce((n, c) => n + c, 0)
  const bar: Span[] = parts.flatMap((p, i): Span[] => {
    const n = cells[i]!
    if (n <= 0) return []
    return p.hatch ? [hatched(n, p.color, typeof p.hatch === "object" ? p.hatch.base : p.color)] : [{ text: "█".repeat(n), fg: p.color }]
  })
  const labels = packLabels(width, [
    ...spans.map((s) => ({ from: s.cols[0], cells: s.cols[1] - s.cols[0], options: s.options, optional: s.optional })),
    ...parts.map((p, i) => ({ from: from(i), cells: cells[i]!, options: p.label ?? [], optional: p.optional })),
  ])
  return { bar: bar.length ? bar : [{ text: "┄".repeat(width), fg: ink.faint }], labels, cells, from }
}

export function flowOpening(width: number, from: number, to: number, label: Span[]): Span[] {
  const left = from > 0 && from < width - 1, right = to < width - 1
  if (from >= width - 1) return [{ text: " ", fg: ink.note }]
  const head: Span = left ? { text: `╭${"─".repeat(from - 1)}╯`, fg: ink.rule } : { text: "│", fg: ink.rule }
  const tail: Span = right ? { text: `╰${"─".repeat(Math.max(0, width - to - 1))}╮`, fg: ink.rule } : { text: "│", fg: ink.rule }
  const room = Math.max(0, width - head.text.length - tail.text.length)
  const w = spansWidth(label)
  const fits = w + 2 <= room
  const pad = fits ? room - w : room
  const lead = Math.floor(pad / 2)
  return [
    head,
    { text: " ".repeat(fits ? lead : room), fg: ink.note },
    ...(fits ? [...label, { text: " ".repeat(pad - lead), fg: ink.note }] : []),
    tail,
  ]
}

export const flowEdges = (width: number): Span[] => [{ text: "│", fg: ink.rule }, { text: " ".repeat(Math.max(0, width - 2)), fg: ink.note }, { text: "│", fg: ink.rule }]
