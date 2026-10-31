/** The Budgets tab's cycle lines: each cycle a bar against the budget in
 * force then. (Its chart is the Overview's spending views: periodCharts.) */
import { formatWholeMoney } from "../../domain/dashboard"
import { MONTHS } from "../../domain/days"
import type { Cycle } from "../../domain/budget"
import { muted, type Span } from "../primitives/spans"
import { GAP, INKS } from "../overview/periodCharts"
import { ink, tone } from "../../theme"

/** A cycle's spending and the budget in force in it (null: none). */
export interface CycleSpent {
  cycle: Cycle
  spent: number
  budget: number | null
}

/** Over or under its budget, and by how much ("$780 over"). */
const verdict = (c: CycleSpent): Span | null =>
  c.budget == null ? null : c.spent > c.budget ? { text: `${formatWholeMoney(c.spent - c.budget)} over`, fg: tone.bad } : { text: `${formatWholeMoney(c.budget - c.spent)} under`, fg: tone.good }

/** How the cycles before this one went: over budget in how many, and
 * their average. */
const pastSummary = (past: CycleSpent[]): Span[] => {
  const budgeted = past.filter((c) => c.budget != null)
  const over = budgeted.filter((c) => c.spent > c.budget!).length
  const avg = past.length ? past.reduce((sum, c) => sum + c.spent, 0) / past.length : null
  return [
    ...(budgeted.length ? [muted(`over in ${over} of ${budgeted.length}`)] : []),
    ...(avg != null ? [muted(`${budgeted.length ? " · " : ""}avg ${formatWholeMoney(avg)}`)] : []),
  ]
}

/**
 * The cycles newest first, a line each: its dates, what was spent, a bar on
 * one scale for them all (green up to the cycle's budget and red past it,
 * the budget marked │ where the bar falls short of it; this cycle's
 * coloured by its pace, ▏ where an even pace would be by now if it falls
 * short of that; without a budget, plain spending), and how far under or
 * over (a year that isn't this one after its dates). `width` is the
 * line's; `pace` is how far through this cycle is.
 */
export function cycleLines(cycles: CycleSpent[], width: number, pace: number, todayISO: string): Span[][] {
  if (!cycles.length) return []
  const scale = Math.max(1, ...cycles.map((c) => Math.max(c.spent, c.budget ?? 0)))
  const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`
  const dates = cycles.map((c) => `${day(c.cycle.start)} – ${day(c.cycle.end)}${c.cycle.end.slice(0, 4) === todayISO.slice(0, 4) ? "" : ` ${c.cycle.end.slice(2, 4)}`}`)
  const verdicts = cycles.map(verdict)
  // Columns as wide as what's in them; the bar takes the rest.
  const DATES = Math.max(...dates.map((d) => d.length)) + 2
  const SPENT = Math.max(...cycles.map((c) => formatWholeMoney(c.spent).length)) + 1
  const VERDICT = Math.max(0, ...verdicts.map((v) => (v ? v.text.length + 1 : 0)))
  const bar = Math.max(1, width - DATES - SPENT - 2 - VERDICT)
  return cycles.map((c, i) => {
    const now = i === 0
    const cells = (v: number) => Math.round((v / scale) * bar)
    const filled = cells(c.spent)
    const limit = c.budget == null ? -1 : Math.min(bar - 1, cells(c.budget))
    const paceAt = now && c.budget != null ? Math.min(bar - 1, cells(c.budget * pace)) : -1
    const fillInk = (k: number) => c.budget == null ? INKS.spend!
      : k >= limit ? tone.bad
      : now ? (c.spent > c.budget * pace ? tone.caution : tone.good)
      : tone.good
    const spans: Span[] = []
    const push = (text: string, fg: string) => {
      const last = spans.at(-1)
      if (last && last.fg === fg) last.text += text
      else spans.push({ text, fg })
    }
    for (let k = 0; k < bar; k++) {
      if (k < filled) push("█", fillInk(k))
      else if (k === limit) push("│", ink.figure)
      else if (k === paceAt) push("▏", ink.note)
      else push(k < Math.max(limit, 0) ? "─" : " ", ink.rule)
    }
    const v = verdicts[i]
    return [
      { text: dates[i]!.padEnd(DATES), fg: now ? ink.figure : ink.label, bold: now },
      { text: `${formatWholeMoney(c.spent).padStart(SPENT - 1)} `, fg: now ? ink.strong : ink.figure, bold: now },
      { text: " ", fg: ink.rule },
      ...spans,
      { text: " ", fg: ink.rule },
      v ? { ...v, text: v.text.padStart(VERDICT) } : { text: "".padStart(VERDICT), fg: ink.note },
    ]
  })
}

/** The cycles' bars' legend: how they went, and what the marks mean. */
export function cycleLinesLegend(cycles: CycleSpent[]): Span[] {
  const budgeted = cycles.some((c) => c.budget != null)
  return [
    ...pastSummary(cycles.slice(1)),
    ...(budgeted ? [GAP, { text: "│", fg: ink.figure }, muted(" budget  "), { text: "▏", fg: ink.note }, muted(" pace now")] : []),
  ]
}
