import { formatPct, formatWholeMoney, signedWholeMoney } from "../../domain/dashboard"
import type { Transaction } from "../../domain/types"
import { leadingEmoji, saverInks } from "../charts/saverInks"
import { fade, ink, tone } from "../../theme"
import { INKS } from "../charts/inks"
import { cellsOf, flowBar, flowEdges, flowOpening, money as bold, packLabels, type FlowPart } from "../charts/flow"
import type { Span } from "../primitives/spans"

const KEPT_FADE = 0.65

const money = (n: number, fg: string): Span => bold(formatWholeMoney(n), fg)
const signed = (n: number, fg: string): Span => bold(signedWholeMoney(n), fg)
const words = (figure: Span, text: string, fg: string = ink.note): Span[][] => [[figure, { text: ` ${text}`, fg }], [figure]]

interface Named { amount: number; color: string; name: string; figure: string }

function namedBar(width: number, parts: Named[]): { bar: Span[]; labels: Span[]; cells: number[] } {
  const cells = cellsOf(parts.map((p) => p.amount), width)
  return flowBar(width, parts.map((p, i) => ({
    amount: p.amount, color: p.color,
    label: words(money(p.amount, p.figure), p.name),
    optional: formatWholeMoney(p.amount).length > cells[i]!,
  })))
}

function inBar(width: number, income: number, spent: number): { above: Span[]; bar: Span[]; netFrom: number } {
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

interface SaverPart { name: string; change: number; color: string }

export function netBar(width: number, net: number, savers: SaverPart[]): { bar: Span[]; labels: Span[] } {
  const gains = savers.filter((s) => s.change >= 0.5).sort((a, b) => b.change - a.change)
  const kept = Math.max(0, net - gains.reduce((n, s) => n + s.change, 0))
  return namedBar(width, [
    ...gains.map((s) => ({ amount: s.change, color: s.color, name: s.name, figure: s.color })),
    { amount: kept, color: fade(tone.good, KEPT_FADE), name: "kept", figure: ink.figure },
  ])
}

export function categoryBar(width: number, groups: Array<{ amount: number; color: string; name: string }>): { bar: Span[]; labels: Span[] } {
  return namedBar(width, groups.filter((g) => g.amount >= 0.5).sort((a, b) => b.amount - a.amount).map((g) => ({ ...g, figure: g.color })))
}

interface SourcePart { amount: number; color: string; name: string; figure: string }

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
  const spending = flowBar(width, [{ amount: covered, color: INKS.spend! }, { amount: gap, color: tone.bad, hatch: true }])
  const c = from.cells[0]!
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

const bare = (name: string) => (leadingEmoji(name) ? name.trim().replace(/^\p{Extended_Pictographic}[\u{FE0E}\u{FE0F}]?\s*/u, "") : name).trim()

interface SpendFlow {
  income: number
  spent: number
  net: number
  savingsRate: number | null
  rows: Transaction[]
  savers: Array<{ accountId: number; name: string }>
  groups: Array<{ amount: number; color: string; name: string }>
  bySpending: boolean
}

export function spendFlow(width: number, f: SpendFlow): Span[][] {
  const colors = saverInks(f.savers.map((s) => s.name))
  const groups = f.groups.map((g) => ({ ...g, name: bare(g.name) }))
  const withSaver = f.savers.map((s, i) => ({ name: bare(s.name), color: colors[i]!, amount: f.rows.filter((t) => t.internal && t.transferAccountId === s.accountId).reduce((n, t) => n + t.amount, 0) }))
  if (f.spent - f.income >= 0.5) {
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
