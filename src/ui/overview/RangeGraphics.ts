import { formatWholeMoney, signedWholeMoney } from "../../domain/dashboard"
import { fade, ink, tone } from "../../theme"
import { cellsOf, labelled } from "../budgets/PlanGraphics"
import type { Span } from "../primitives/spans"

/**
 * The Range pane's picture of the Date Range's money: what came in as one
 * bar, the Budgets pay bar's way. Pure builders.
 */

/** A part of the range's spending: a category group, in its colour. */
export interface RangePart { amount: number; color: string }

/** How much "kept" (in, not spent or sent) fades from savers' colour. */
const KEPT_FADE = 0.65

/**
 * What came in as one bar `width` wide: each category group's spending in
 * its colour, then what went to savers (good), then what stayed (a dim
 * good: in, and neither spent nor sent). Spending more than came in fills
 * the bar with spending. `before` (the earlier period's spending, where
 * the history covers it) is a tick on the bar where that spending would
 * reach. Over it what's spent and the net; under it, before at its tick.
 */
export function rangeBar(width: number, income: number, parts: RangePart[], toSavers: number, net: number, before: number | null): { above: Span[]; bar: Span[]; below: Span[] } {
  const groups = parts.filter((p) => p.amount > 0)
  const spent = groups.reduce((n, p) => n + p.amount, 0)
  const saved = Math.max(0, toSavers)
  const kept = Math.max(0, income - spent - saved)
  const runs = [...groups.map((p) => ({ amount: p.amount, color: p.color })), { amount: saved, color: tone.good }, { amount: kept, color: fade(tone.good, KEPT_FADE) }]
  const scale = runs.reduce((n, r) => n + r.amount, 0)
  const cells = cellsOf(runs.map((r) => r.amount), width)
  // Cell by cell, so the tick can sit on whichever colour is under it.
  const colors = runs.flatMap((r, i) => Array<string>(Math.max(0, cells[i]!)).fill(r.color))
  const tick = before != null && before > 0 && scale > 0 ? Math.min(width - 1, Math.round((before / scale) * width)) : -1
  const bar: Span[] = []
  colors.forEach((color, c) => {
    const span: Span = c === tick ? { text: "┃", fg: ink.strong, bg: color, bold: true } : { text: "█", fg: color }
    const last = bar.at(-1)
    if (last && c !== tick && last.text.startsWith("█") && last.fg === span.fg) last.text += "█"
    else bar.push(span)
  })
  if (!bar.length) bar.push({ text: "┄".repeat(width), fg: ink.faint })
  const spentCells = scale > 0 ? Math.round((spent / scale) * width) : 0
  const money = (n: number, fg: string): Span => ({ text: formatWholeMoney(n), fg, bold: true })
  const above = labelled(width, [
    ...(spent > 0 ? [{ mid: spentCells / 2, options: [[money(spent, tone.bad), { text: " spent", fg: ink.note }], [money(spent, tone.bad)]] }] : []),
    { mid: spentCells < width ? (spentCells + width) / 2 : width, options: [[{ text: signedWholeMoney(net), fg: net < -0.5 ? tone.bad : tone.good, bold: true }, { text: " net", fg: ink.note }]] },
  ])
  // Under it, the earlier period's spending, its ▲ under the tick: the
  // words after it, or before it where they'd run off the end.
  const words: Span[] = before != null ? [{ text: "before ", fg: ink.note }, money(before, ink.label)] : []
  const w = words.reduce((n, x) => n + x.text.length, 0) + 2
  const below = tick < 0 ? [{ text: " ", fg: ink.note }]
    : tick + w <= width ? labelled(width, [{ at: tick, options: [[{ text: "▲ ", fg: ink.strong }, ...words]] }])
    : labelled(width, [{ at: Math.max(0, tick - w + 1), options: [[...words, { text: " ▲", fg: ink.strong }]] }])
  return { above, bar, below }
}
