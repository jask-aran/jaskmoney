import { formatWholeMoney } from "../../domain/dashboard"
import { MONTHS } from "../../domain/days"
import type { Cycle } from "../../domain/budget"
import { muted, type Span } from "../primitives/spans"
import { GAP, INKS } from "../overview/periodCharts"
import { ink, tone } from "../../theme"

export interface CycleSpent {
  cycle: Cycle
  spent: number
  budget: number | null
}

const verdict = (c: CycleSpent): Span | null =>
  c.budget == null ? null : c.spent > c.budget ? { text: `${formatWholeMoney(c.spent - c.budget)} over`, fg: tone.bad } : { text: `${formatWholeMoney(c.budget - c.spent)} under`, fg: tone.good }

const pastSummary = (past: CycleSpent[]): Span[] => {
  const budgeted = past.filter((c) => c.budget != null)
  const over = budgeted.filter((c) => c.spent > c.budget!).length
  const avg = past.length ? past.reduce((sum, c) => sum + c.spent, 0) / past.length : null
  return [
    ...(budgeted.length ? [muted(`over in ${over} of ${budgeted.length}`)] : []),
    ...(avg != null ? [muted(`${budgeted.length ? " · " : ""}avg ${formatWholeMoney(avg)}`)] : []),
  ]
}

export function cycleLines(cycles: CycleSpent[], width: number, pace: number, todayISO: string): Span[][] {
  if (!cycles.length) return []
  const scale = Math.max(1, ...cycles.map((c) => Math.max(c.spent, c.budget ?? 0)))
  const day = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`
  const dates = cycles.map((c) => `${day(c.cycle.start)} – ${day(c.cycle.end)}${c.cycle.end.slice(0, 4) === todayISO.slice(0, 4) ? "" : ` ${c.cycle.end.slice(2, 4)}`}`)
  const verdicts = cycles.map(verdict)
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

export function cycleLinesLegend(cycles: CycleSpent[]): Span[] {
  const budgeted = cycles.some((c) => c.budget != null)
  return [
    ...pastSummary(cycles.slice(1)),
    ...(budgeted ? [GAP, { text: "│", fg: ink.figure }, muted(" budget  "), { text: "▏", fg: ink.note }, muted(" pace now")] : []),
  ]
}
