import { formatWholeMoney, signedWholeMoney } from "../../domain/dashboard"
import { fade, ink, tone } from "../../theme"
import { INKS } from "../charts/inks"
import { cellsOf, hatched, labelled, spansWidth } from "../budgets/PlanGraphics"
import type { Span } from "../primitives/spans"

/**
 * The Range pane's pictures of the Date Range's money, the Budgets pay
 * bar's way: what came in as a bar (spent, net), its net end opened out to
 * where the net went (each saver, kept), and the spending by category
 * group opened out of the spent part instead (s). Pure builders.
 */

/** How much "kept" (net that stayed in Spending) fades from good. */
const KEPT_FADE = 0.65

/** Runs of solid cells, one span a run. */
const runs = (parts: Array<{ cells: number; color: string }>): Span[] =>
  parts.filter((p) => p.cells > 0).map((p) => ({ text: "█".repeat(p.cells), fg: p.color }))

const money = (n: number, fg: string): Span => ({ text: formatWholeMoney(n), fg, bold: true })

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

/** Each part's figure and name over (or under) it, as `packLabels` places
 * them. A part narrower than its bare figure may go unlabelled. */
function partLabels(width: number, parts: Array<{ amount: number; name: string; figure: string }>, cells: number[]): Span[] {
  return packLabels(width, parts.map((p, i) => ({
    from: cells.slice(0, i).reduce((n, c) => n + c, 0), cells: cells[i]!,
    options: [[money(p.amount, p.figure), { text: ` ${p.name}`, fg: ink.note }], [money(p.amount, p.figure)]],
    optional: formatWholeMoney(p.amount).length > cells[i]!,
  })))
}

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
  const above = packLabels(width, [
    ...(spent > 0 ? [{ from: 0, cells: s + o, options: [[money(spent, ink.figure), { text: " spent", fg: ink.note }], [money(spent, ink.figure)]] }] : []),
    ...(o > 0 ? [{ from: s, cells: o, options: [[money(over, tone.bad), { text: " over", fg: tone.bad }], [money(over, tone.bad)]] }] : []),
    ...(n > 0 ? [{ from: s + o, cells: n, options: [[{ text: signedWholeMoney(net), fg: tone.good, bold: true }, { text: " net", fg: ink.note }], [{ text: signedWholeMoney(net), fg: tone.good, bold: true }]] }] : []),
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
  const labels = partLabels(width, parts, cells)
  return { bar: bar.length ? bar : [{ text: "┄".repeat(width), fg: ink.faint }], labels }
}

/**
 * Where the spending went, as a bar `width` wide: each category group in
 * its colour, largest first. Under it each group's figure and name where
 * they fit, the smallest's words going first.
 */
export function categoryBar(width: number, groups: Array<{ amount: number; color: string; name: string }>): { bar: Span[]; labels: Span[] } {
  const parts = groups.filter((g) => g.amount >= 0.5).sort((a, b) => b.amount - a.amount).map((g) => ({ amount: g.amount, color: g.color, name: g.name, figure: g.color }))
  const cells = cellsOf(parts.map((p) => p.amount), width)
  const bar = runs(parts.map((p, i) => ({ cells: cells[i]!, color: p.color })))
  return { bar: bar.length ? bar : [{ text: "┄".repeat(width), fg: ink.faint }], labels: partLabels(width, parts, cells) }
}

/** A source of spending past what came in, measured: transfers in from
 * outside, a saver drawn on, Spending's own balance. */
export interface SourcePart { amount: number; color: string; name: string; figure: string }

/**
 * Spending more than came in: where the spending came from, over what was
 * spent, both `width` wide for the same total (what was spent), a line of
 * edges between them saying so. The sources: what came in (good), then
 * `sources`, each measured over the range. Past what the spending needed,
 * they cover only that, shared by their sizes (the rest went elsewhere:
 * to savers, or stayed); short of it, the rest is "other", never guessed
 * at. Under it what was spent: what came in covered in spending's colour,
 * and past it hatched in bad, under the parts that paid for it. Figures
 * over the sources, under the spending.
 */
export function sourcesBars(width: number, income: number, spent: number, sources: SourcePart[], categories?: Array<{ amount: number; color: string; name: string }>): Span[][] {
  const covered = Math.min(spent, Math.max(0, income)), gap = spent - covered
  const given = sources.filter((s) => s.amount >= 0.5)
  const total = given.reduce((n, s) => n + s.amount, 0)
  const share = total > gap ? gap / total : 1
  const other = Math.max(0, gap - total * share)
  const parts = [
    { amount: covered, color: tone.good, name: "in", figure: ink.figure },
    ...given.map((s) => ({ ...s, amount: s.amount * share })),
    ...(other >= 0.5 ? [{ amount: other, color: ink.faint, name: "other", figure: ink.label }] : []),
  ]
  const cells = cellsOf(parts.map((p) => p.amount), width)
  const sourceBar = runs(parts.map((p, i) => ({ cells: cells[i]!, color: p.color })))
  const above = partLabels(width, parts, cells)
  // The same columns: what came in covered ends where its source does.
  const c = cells[0]!, o = width - c
  const spending: Span[] = [...runs([{ cells: c, color: INKS.spend! }]), ...(o > 0 ? [hatched(o, tone.bad, tone.bad)] : [])]
  // Where the spending went (s): under the spending, its categories as a
  // third bar of the same total, the spent and net figures between them
  // inside the edges, the largest groups named under it.
  const inner = categories ? width - 4 : width
  // Inside the edges, two cells in from each side.
  const inset = categories ? 2 : 0
  const below = packLabels(inner, [
    { from: 0, cells: Math.max(1, (c > 0 ? c : width) - inset), options: [[money(spent, ink.figure), { text: " spent", fg: ink.note }], [money(spent, ink.figure)]] },
    ...(o > 0 && c > 0 ? [{ from: Math.max(0, c - inset), cells: Math.max(1, Math.min(o, inner - c + inset)), options: [[{ text: signedWholeMoney(-gap), fg: tone.bad, bold: true }, { text: " net", fg: ink.note }], [{ text: signedWholeMoney(-gap), fg: tone.bad, bold: true }]] }] : []),
  ])
  const edges: Span[] = [{ text: "│", fg: ink.rule }, { text: " ".repeat(Math.max(0, width - 2)), fg: ink.note }, { text: "│", fg: ink.rule }]
  if (!categories) return [above, sourceBar, edges, spending, below]
  const inside: Span[] = [{ text: "│ ", fg: ink.rule }, ...below, { text: " ".repeat(Math.max(0, inner - below.reduce((n, x) => n + x.text.length, 0))), fg: ink.note }, { text: " │", fg: ink.rule }]
  const bar = categoryBar(width, categories)
  return [above, sourceBar, edges, spending, inside, bar.bar, bar.labels]
}

/**
 * Under the in bar, the line that opens its spent end (columns 0 to `to`)
 * out to the full width for the spending's breakdown under it: the left
 * edge straight down, a corner under where the spending ends running on
 * to the right edge, and `label` between. The savers opening's mirror.
 */
export function spendOpening(width: number, to: number, label: Span[]): Span[] {
  const room = Math.max(0, to - 2)
  const w = label.reduce((n, x) => n + x.text.length, 0)
  const fits = w + 2 <= room
  const pad = fits ? room - w : room
  const left = Math.floor(pad / 2)
  if (to >= width - 1) return [{ text: "│", fg: ink.rule }, { text: " ".repeat(Math.max(0, left)), fg: ink.note }, ...(fits ? label : []), { text: " ".repeat(Math.max(0, width - 2 - left - (fits ? w : 0))), fg: ink.note }, { text: "│", fg: ink.rule }]
  return [
    { text: "│", fg: ink.rule },
    { text: " ".repeat(fits ? left : room), fg: ink.note },
    ...(fits ? [...label, { text: " ".repeat(pad - left), fg: ink.note }] : []),
    { text: `╰${"─".repeat(Math.max(0, width - to - 1))}╮`, fg: ink.rule },
  ]
}
