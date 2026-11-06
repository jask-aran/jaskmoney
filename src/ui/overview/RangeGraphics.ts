import { formatWholeMoney, signedWholeMoney } from "../../domain/dashboard"
import { fade, ink, tone } from "../../theme"
import { INKS } from "../charts/inks"
import { cellsOf, hatched, labelled } from "../budgets/PlanGraphics"
import type { Span } from "../primitives/spans"

/**
 * The Range pane's pictures of the Date Range's money, the Budgets pay
 * bar's way: what came in as a bar (spent, net), its net end opened out to
 * where the net went (each saver, kept), and the spending by category
 * group over the categories. Pure builders.
 */

/** How much "kept" (net that stayed in Spending) fades from good. */
const KEPT_FADE = 0.65

/** Runs of solid cells, one span a run. */
const runs = (parts: Array<{ cells: number; color: string }>): Span[] =>
  parts.filter((p) => p.cells > 0).map((p) => ({ text: "█".repeat(p.cells), fg: p.color }))

const money = (n: number, fg: string): Span => ({ text: formatWholeMoney(n), fg, bold: true })

/**
 * What came in as one bar `width` wide: what's spent in spending's colour
 * (the charts'), then the net in good. Spending past what came in runs
 * on, hatched in bad. Over it each part's figure. `netFrom` is the column
 * the net starts at, for the opening under it.
 */
export function inBar(width: number, income: number, spent: number): { above: Span[]; bar: Span[]; netFrom: number } {
  const within = Math.min(spent, Math.max(0, income)), over = Math.max(0, spent - Math.max(0, income)), net = Math.max(0, income - spent)
  const [s, o, n] = cellsOf([within, over, net], width) as [number, number, number]
  const bar: Span[] = [...runs([{ cells: s, color: INKS.spend! }]), ...(o > 0 ? [hatched(o, tone.bad, tone.bad)] : []), ...runs([{ cells: n, color: tone.good }])]
  const above = labelled(width, [
    ...(spent > 0 ? [{ mid: (s + o) / 2, options: [[money(spent, ink.figure), { text: " spent", fg: ink.note }], [money(spent, ink.figure)]] }] : []),
    ...(o > 0 ? [{ mid: s + o / 2, options: [[money(over, tone.bad), { text: " over", fg: tone.bad }], [money(over, tone.bad)]] }] : []),
    ...(n > 0 ? [{ mid: s + o + n / 2, options: [[{ text: signedWholeMoney(net), fg: tone.good, bold: true }, { text: " net", fg: ink.note }], [{ text: signedWholeMoney(net), fg: tone.good, bold: true }]] }] : []),
  ])
  return { above, bar: bar.length ? bar : [{ text: "┄".repeat(width), fg: ink.faint }], netFrom: s + o }
}

/** A saver's part of the net: its change over the range, in its colour. */
export interface SaverPart { name: string; change: number; color: string }

/**
 * Where the net went, as a bar `width` wide: each saver's gain in its
 * colour (largest first), then what stayed in Spending (a dim good). Under
 * it each part's figure and name where they fit. Savers that gained more
 * than the net between them fill the bar with their gains alone.
 */
export function netBar(width: number, net: number, savers: SaverPart[]): { bar: Span[]; labels: Span[] } {
  const gains = savers.filter((s) => s.change >= 0.5).sort((a, b) => b.change - a.change)
  const kept = Math.max(0, net - gains.reduce((n, s) => n + s.change, 0))
  const parts = [...gains.map((s) => ({ amount: s.change, color: s.color, name: s.name, figure: s.color })), { amount: kept, color: fade(tone.good, KEPT_FADE), name: "kept", figure: ink.figure }]
  const cells = cellsOf(parts.map((p) => p.amount), width)
  const bar = runs(parts.map((p, i) => ({ cells: cells[i]!, color: p.color })))
  let from = 0
  const labels = labelled(width, parts.flatMap((p, i) => {
    const mid = from + cells[i]! / 2
    from += cells[i]!
    if (cells[i]! <= 0) return []
    return [{ mid, options: [[money(p.amount, p.figure), { text: ` ${p.name}`, fg: ink.note }], [money(p.amount, p.figure)]] }]
  }))
  return { bar: bar.length ? bar : [{ text: "┄".repeat(width), fg: ink.faint }], labels }
}

/**
 * The range's spending by category group as a bar `width` wide, each in
 * its colour, against before (the earlier period's spending, where the
 * history covers it): the bar runs to whichever is more, the rest dotted,
 * with a tick where before reached and its figure under it.
 */
export function spendBar(width: number, groups: Array<{ amount: number; color: string }>, before: number | null): { bar: Span[]; below: Span[] } {
  const parts = groups.filter((g) => g.amount > 0)
  const spent = parts.reduce((n, g) => n + g.amount, 0)
  const scale = Math.max(spent, before ?? 0)
  if (scale <= 0) return { bar: [{ text: "┄".repeat(width), fg: ink.faint }], below: [{ text: " ", fg: ink.note }] }
  const cells = cellsOf([...parts.map((g) => g.amount), scale - spent], width)
  const colors = parts.flatMap((g, i) => Array<string>(Math.max(0, cells[i]!)).fill(g.color))
  const tick = before != null && before > 0 ? Math.min(width - 1, Math.max(0, Math.round((before / scale) * width) - 1)) : -1
  const bar: Span[] = []
  for (let c = 0; c < width; c++) {
    const span: Span = c === tick ? { text: "┃", fg: ink.strong, bg: colors[c], bold: true } : c < colors.length ? { text: "█", fg: colors[c]! } : { text: "┄", fg: ink.faint }
    const last = bar.at(-1)
    if (last && c !== tick && c - 1 !== tick && last.fg === span.fg && last.text[0] === span.text) last.text += span.text
    else bar.push(span)
  }
  // Before's figure, its ▲ under the tick: the words after it, or before
  // it where they'd run off the end.
  const words: Span[] = before != null ? [{ text: "before ", fg: ink.note }, money(before, ink.label)] : []
  const w = words.reduce((n, x) => n + x.text.length, 0) + 2
  const below = tick < 0 ? [{ text: " ", fg: ink.note }]
    : tick + w <= width ? labelled(width, [{ at: tick, options: [[{ text: "▲ ", fg: ink.strong }, ...words]] }])
    : labelled(width, [{ at: Math.max(0, tick - w + 1), options: [[...words, { text: " ▲", fg: ink.strong }]] }])
  return { bar, below }
}
