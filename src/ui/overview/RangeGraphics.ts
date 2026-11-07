import { formatPct, formatWholeMoney, signedWholeMoney } from "../../domain/dashboard"
import type { Transaction } from "../../domain/types"
import { leadingEmoji, saverInks } from "../charts/saverInks"
import { fade, ink, tone } from "../../theme"
import { INKS } from "../charts/inks"
import { cellsOf, flowBar, flowEdges, flowOpening, money as bold, packLabels, type FlowPart } from "../charts/flow"
import type { Span } from "../primitives/spans"

/**
 * The Range pane's flows (`../charts/flow`), the Budgets pay bar's way:
 * what came in as a bar (spent, net), its net end opened out to where the
 * net went (each saver, kept), or its spent end to where the spending
 * went (each category group, s); spending past what came in, where it
 * came from over what was spent. Pure builders.
 */

/** How much "kept" (net that stayed in Spending) fades from good. */
const KEPT_FADE = 0.65

const money = (n: number, fg: string): Span => bold(formatWholeMoney(n), fg)
const signed = (n: number, fg: string): Span => bold(signedWholeMoney(n), fg)
const words = (figure: Span, text: string, fg: string = ink.note): Span[][] => [[figure, { text: ` ${text}`, fg }], [figure]]

/** A part with its figure (in `figure`) and name. */
interface Named { amount: number; color: string; name: string; figure: string }

/** Named parts as a bar `width` wide, each figure and name under it where
 * they fit: a part thinner than its figure may go unlabelled. */
function namedBar(width: number, parts: Named[]): { bar: Span[]; labels: Span[]; cells: number[] } {
  const cells = cellsOf(parts.map((p) => p.amount), width)
  return flowBar(width, parts.map((p, i) => ({
    amount: p.amount, color: p.color,
    label: words(money(p.amount, p.figure), p.name),
    optional: formatWholeMoney(p.amount).length > cells[i]!,
  })))
}

/**
 * What came in as one bar `width` wide: what's spent in spending's colour
 * (the charts'), then the net in good. Spending past what came in runs
 * on, hatched in bad. Over it each part's figure, what's spent over all
 * of it. `netFrom` is the column the net starts at, for the opening under
 * it.
 */
export function inBar(width: number, income: number, spent: number): { above: Span[]; bar: Span[]; netFrom: number } {
  const within = Math.min(spent, Math.max(0, income)), over = Math.max(0, spent - Math.max(0, income)), net = Math.max(0, income - spent)
  const parts: FlowPart[] = [
    { amount: within, color: INKS.spend! },
    { amount: over, color: tone.bad, hatch: true, label: words(money(over, tone.bad), "over", tone.bad) },
    { amount: net, color: tone.good, label: words(signed(net, tone.good), "net") },
  ]
  const cells = cellsOf(parts.map((p) => p.amount), width)
  const netFrom = cells[0]! + cells[1]!
  const { bar, labels } = flowBar(width, parts, spent > 0 ? [{ cols: [0, netFrom], options: words(money(spent, ink.figure), "spent") }] : [])
  return { above: labels, bar, netFrom }
}

/** A saver's part of the net: its change over the range, in its colour. */
export interface SaverPart { name: string; change: number; color: string }

/**
 * Where the net went, as a bar `width` wide: what went to each saver in its
 * colour (largest first), then what stayed in Spending (a dim good). Under
 * it each part's figure and name where they fit. Savers that gained more
 * than the net between them fill the bar with their gains alone.
 */
export function netBar(width: number, net: number, savers: SaverPart[]): { bar: Span[]; labels: Span[] } {
  const gains = savers.filter((s) => s.change >= 0.5).sort((a, b) => b.change - a.change)
  const kept = Math.max(0, net - gains.reduce((n, s) => n + s.change, 0))
  return namedBar(width, [
    ...gains.map((s) => ({ amount: s.change, color: s.color, name: s.name, figure: s.color })),
    { amount: kept, color: fade(tone.good, KEPT_FADE), name: "kept", figure: ink.figure },
  ])
}

/**
 * Where the spending went, as a bar `width` wide: each category group in
 * its colour, largest first. Under it each group's figure and name where
 * they fit, the smallest's words going first.
 */
export function categoryBar(width: number, groups: Array<{ amount: number; color: string; name: string }>): { bar: Span[]; labels: Span[] } {
  return namedBar(width, groups.filter((g) => g.amount >= 0.5).sort((a, b) => b.amount - a.amount).map((g) => ({ ...g, figure: g.color })))
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
  const from = namedBar(width, [
    { amount: covered, color: tone.good, name: "in", figure: ink.figure },
    ...given.map((s) => ({ ...s, amount: s.amount * share })),
    ...(other >= 0.5 ? [{ amount: other, color: ink.faint, name: "other", figure: ink.label }] : []),
  ])
  // The same total, so the same columns: what came in covered ends where
  // its source does.
  const spending = flowBar(width, [{ amount: covered, color: INKS.spend! }, { amount: gap, color: tone.bad, hatch: true }])
  const c = from.cells[0]!
  // Where the spending went (s): under the spending, its categories as a
  // third bar of the same total, the spent and net figures between them
  // inside the edges (two cells in from each), the groups named under it.
  const inset = categories ? 2 : 0, inner = width - 2 * inset
  const below = packLabels(inner, [
    { from: 0, cells: Math.max(1, (c > 0 ? c : width) - inset), options: words(money(spent, ink.figure), "spent") },
    ...(gap > 0 && c > 0 && c < width ? [{ from: Math.max(0, c - inset), cells: Math.max(1, Math.min(inner, width - inset) - Math.max(0, c - inset)), options: words(signed(-gap, tone.bad), "net") }] : []),
  ])
  const head = [from.labels, from.bar, flowEdges(width), spending.bar]
  if (!categories) return [...head, below]
  const inside: Span[] = [{ text: "│ ", fg: ink.rule }, ...below, { text: " ".repeat(Math.max(0, inner - below.reduce((n, x) => n + x.text.length, 0))), fg: ink.note }, { text: " │", fg: ink.rule }]
  const bar = categoryBar(width, categories)
  return [...head, inside, bar.bar, bar.labels]
}

/** A name without its leading emoji: the colour is the saver's, and an
 * emoji's width would put the labels out. */
const bare = (name: string) => (leadingEmoji(name) ? name.trim().replace(/^\p{Extended_Pictographic}[\u{FE0E}\u{FE0F}]?\s*/u, "") : name).trim()

/** What a span's flow is drawn from: its flows (computePeriodFlows'), the
 * spending accounts' rows in it, the savers (in their chart's order) and
 * the category groups' spending. */
export interface SpendFlow {
  income: number
  spent: number
  net: number
  savingsRate: number | null
  rows: Transaction[]
  savers: Array<{ accountId: number; name: string }>
  groups: Array<{ amount: number; color: string; name: string }>
  /** Open out where the spending went (else where the net went). */
  bySpending: boolean
}

/**
 * A span's flow, the Overview's Range pane's and the Budgets pane's alike:
 * what came in as a bar (spent, net), one end opened out under it: the
 * spending to its category groups, or the net to where it went (what was
 * sent to each saver, then what stayed in Spending as kept: with the
 * savers meter's sent and to send, the same figures). Spending past what
 * came in: where it came from over what was spent.
 */
export function spendFlow(width: number, f: SpendFlow): Span[][] {
  const colors = saverInks(f.savers.map((s) => s.name))
  const groups = f.groups.map((g) => ({ ...g, name: bare(g.name) }))
  // Each saver's net with Spending over the span: in from it (+), sent to it (-).
  const withSaver = f.savers.map((s, i) => ({ name: bare(s.name), color: colors[i]!, amount: f.rows.filter((t) => t.internal && t.transferAccountId === s.accountId).reduce((n, t) => n + t.amount, 0) }))
  if (f.spent - f.income >= 0.5) {
    // Each source measured over the span: transfers in from outside (not
    // income, not spending, from no tracked account), net; what each saver
    // sent into Spending, net; and how far Spending's own balance fell.
    const outside = f.rows.filter((t) => t.excluded && !t.internal && !t.income).reduce((n, t) => n + t.amount, 0)
    const fell = -f.rows.reduce((n, t) => n + t.amount, 0)
    const sources = [
      { amount: outside, color: INKS.transfers!, name: "transfers", figure: INKS.transfers! },
      ...withSaver.map((s) => ({ ...s, figure: s.color })).sort((x, y) => y.amount - x.amount),
      { amount: fell, color: fade(tone.good, KEPT_FADE), name: "Spending", figure: ink.figure },
    ]
    return sourcesBars(width, f.income, f.spent, sources, f.bySpending ? groups : undefined)
  }
  const bar = inBar(width, f.income, f.spent)
  const lines = [bar.above, bar.bar]
  if (f.bySpending && f.spent >= 0.5) {
    const spending = categoryBar(width, groups)
    lines.push(flowOpening(width, 0, bar.netFrom, [{ text: formatPct(f.income > 0 ? (f.spent / f.income) * 100 : null), fg: ink.figure, bold: true }, { text: " spent", fg: ink.note }]), spending.bar, spending.labels)
  } else if (!f.bySpending && f.net >= 0.5 && bar.netFrom > 0) {
    const net = netBar(width, f.net, withSaver.map((s) => ({ name: s.name, color: s.color, change: -s.amount })))
    lines.push(flowOpening(width, bar.netFrom, width, [{ text: formatPct(f.savingsRate), fg: ink.figure, bold: true }, { text: " saved", fg: ink.note }]), net.bar, net.labels)
  }
  return lines
}
