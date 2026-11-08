import { fade, ink } from "../../theme"
import type { Span } from "../primitives/spans"

/**
 * The flow: an inline vertical Sankey, money as bars of parts all the same
 * width, one under another. A part is an amount in its colour (solid, or
 * hatched for what's gone past where it should), its figure and words
 * over or under it; an opening carries one bar's part out to the full
 * width of the bar under it (that part broken down); edges between two
 * bars say they're the same total. Budgets' pay bar and savers meter and
 * the Overview's Range pane are flows. Pure builders.
 */

export const spansWidth = (spans: Span[]) => spans.reduce((n, l) => n + l.text.length, 0)

/** Cells for each part across `width`, from the running total so the
 * rounding never shortens the whole. */
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

/** Hatching: what's gone past where it should, drawn as diagonal lines
 * in `fg` over a dim shade of `base`. */
const HATCH = "╱"
export const hatched = (cells: number, fg: string, base: string): Span => ({ text: HATCH.repeat(cells), fg, bg: fade(base, 0.7) })

/** A label for `labelled`: its options, best first, placed from `at`
 * or centred on `mid`. */
interface Label { at?: number; mid?: number; options: Span[][] }

/** Labels on a line `width` wide, in priority order: each takes its first
 * option that fits where it goes (kept on the line) without touching one
 * already placed, else is dropped. */
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

/** A part's label for `packLabels`: the part's columns, its options
 * best first, and whether it may go unlabelled before others lose words. */
interface PartLabel { from: number; cells: number; options: Span[][]; optional?: boolean }

/** The cells between two labels. */
const LABEL_GAP = 2

/**
 * Labels for a bar's parts on a line `width` wide, each as near centred
 * on its part as the others let it be: crowded, they slide apart (each
 * still over some of its part) rather than one dropping. Where they still
 * don't fit, in turn: optional parts' labels go (smallest first), then the
 * smallest parts take their shorter options (a bare figure), then the
 * smallest go.
 */
export function packLabels(width: number, parts: PartLabel[]): Span[] {
  const items = parts.filter((p) => p.cells > 0 && p.options.length > 0)
  const level = items.map(() => 0)
  const bySize = items.map((_, k) => k).sort((x, y) => items[x]!.cells - items[y]!.cells)
  // Where the shown labels go, or null where they can't all.
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

/** A figure in bold, the flow's way. */
export const money = (text: string, fg: string): Span => ({ text, fg, bold: true })

/** A part of a flow's bar: an amount in its colour, solid or hatched (in
 * `color` over a dim shade of `base`, default its colour); its label's
 * options, best first; optional, it may go unlabelled first. */
export interface FlowPart { amount: number; color: string; hatch?: boolean | { base: string }; label?: Span[][]; optional?: boolean }

/** A label over columns `cols` (from, to) of a bar rather than one of
 * its parts: a total over several parts, or what's spent of them. */
interface FlowSpanLabel { cols: [number, number]; options: Span[][]; optional?: boolean }

/**
 * A flow's bar `width` wide: each part's cells in its colour, the bar
 * empty (dotted) where there's nothing. Its labels, packed: each part's,
 * and any over columns of it (`spans`). `cells` and `from(i)` for the openings
 * under it.
 */
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

/**
 * Under a flow's bar, the line that opens its columns `from` to `to` out
 * to the full width for the bar under it: a corner under each end of the
 * part that isn't the bar's (running out to the edge), the edge straight
 * down where the part reaches it, and `label` between where it fits.
 * Opening nothing (a part a cell wide at the end), a blank line.
 */
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

/** Between two bars of the same total: their edges, and nothing else. */
export const flowEdges = (width: number): Span[] => [{ text: "│", fg: ink.rule }, { text: " ".repeat(Math.max(0, width - 2)), fg: ink.note }, { text: "│", fg: ink.rule }]
