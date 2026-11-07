import { formatWholeMoney } from "../../domain/dashboard"
import { daysBetween } from "../../domain/days"
import { fade, ink, theme, tone } from "../../theme"
import { LEVEL_BG } from "../overview/CalendarView"
import { shortDate } from "../text"
import type { Span } from "../primitives/spans"
import { cellsOf, flowBar, labelled, money as bold, spansWidth, type FlowPart } from "../charts/flow"

/**
 * The Budgets pane's pictures of the plan and the cycle: each pay as one
 * bar (where it goes: the category budgets, the rest of the spending
 * target, savers), its savers end opened out to the plan for savers as a
 * meter (both flows: `../charts/flow`), and the cycle as a track from
 * payday to payday. Pure builders.
 */

/** The target's colour: the charts' Budget line's, so the target reads
 * the same in the bar as on the chart. */
const targetFill = () => theme.chartBudget

/** A figure in bold, the flow's way. */
const money = (n: number, fg: string): Span => bold(formatWholeMoney(n), fg)

/** One part of each pay: a category's budget, the rest of the target, savers. */
export interface PayPart { name: string; amount: number; color: string; spent: number }

/**
 * Each pay as one bar `width` wide, filling as the cycle's spending comes
 * in. The target first: each category budget in its colour, then the rest
 * of the target in the budget's (the charts' Budget line), each solid for
 * what's spent against it and a dim shade for what's left (a category over
 * its budget takes the excess from the rest). Spending past the target is
 * hatched in bad, between the target and savers: it comes out of what
 * savers get. Then savers, what's left of the pay, in good. With no pay
 * set, there are no savers. Over the bar each part's figure: the target
 * (with no pay, what's spent of it), how far over, and what's left (of the
 * pay, or of the target). The
 * legend gives the categories spent of budget.
 */
export function payBar(width: number, pay: number | null, target: number, categories: PayPart[], restSpent: number): { above: Span[]; bar: Span[]; legend: Span[][]; targetCells: number } {
  const allocated = categories.reduce((n, c) => n + c.amount, 0)
  const cap = Math.max(target, allocated)
  const rest = Math.max(0, target - allocated)
  const spent = categories.reduce((n, c) => n + c.spent, 0) + restSpent
  const excess = categories.reduce((n, c) => n + Math.max(0, c.spent - c.amount), 0)
  const restFilled = Math.min(rest, restSpent + excess)
  const over = Math.max(0, spent - cap)
  const saved = pay != null ? Math.max(0, pay - cap - over) : 0
  // Each part's spent and left, in that order, as runs of the bar.
  const runs: Array<FlowPart & { part: "target" | "over" | "savers" }> = [
    ...categories.flatMap((c) => [
      { amount: Math.min(c.spent, c.amount), color: c.color, part: "target" as const },
      { amount: c.amount - Math.min(c.spent, c.amount), color: fade(c.color, LEFT_FADE), part: "target" as const },
    ]),
    { amount: restFilled, color: targetFill(), part: "target" },
    { amount: rest - restFilled, color: fade(targetFill(), LEFT_FADE), part: "target" },
    { amount: over, color: tone.bad, part: "over", hatch: true },
    { amount: saved, color: tone.good, part: "savers" },
  ]
  // Over the bar: the target over its part, how far over over the hatching,
  // and what's left of the pay over the rest (left of the target, with no
  // pay). Each a label over its columns of the bar.
  const left = (pay ?? target) - spent
  const cells = cellsOf(runs.map((r) => r.amount), width)
  const targetCells = runs.reduce((n, r, i) => n + (r.part === "target" ? cells[i]! : 0), 0)
  const overCells = runs.reduce((n, r, i) => n + (r.part === "over" ? cells[i]! : 0), 0)
  const total = runs.reduce((n, r) => n + Math.max(0, r.amount), 0)
  const spentCells = total > 0 ? Math.min(width, Math.round((Math.min(spent, total) / total) * width)) : 0
  const { bar, labels: above } = flowBar(width, runs, [
    // With no pay the target is the whole bar: what's spent of it instead.
    ...(pay == null ? [{ cols: [0, Math.max(1, spentCells)] as [number, number], options: [[money(spent, over > 0 ? tone.bad : ink.figure), { text: " spent", fg: ink.note }], [money(spent, ink.figure)]] }]
      : targetCells > 0 ? [{ cols: [0, targetCells] as [number, number], options: [[money(target, ink.figure), { text: " target", fg: ink.note }], [money(target, ink.figure)]] }] : []),
    ...(overCells > 0 ? [{ cols: [targetCells, targetCells + overCells] as [number, number], options: [[money(over, tone.bad), { text: " over", fg: tone.bad }], [money(over, tone.bad)]] }] : []),
    ...(left > 0.5 && width - spentCells > 0 ? [{ cols: [spentCells, width] as [number, number], options: [[money(left, ink.figure), { text: " left", fg: ink.note }], [money(left, ink.figure)]] }] : []),
  ])
  const legend: Span[][] = []
  if (categories.length) {
    // Each part spent of its budget; onto a second line where they don't fit.
    const item = (name: string, color: string, used: number, budget: number): Span[] => [
      { text: "■ ", fg: color },
      { text: `${name} `, fg: ink.label },
      { text: formatWholeMoney(used), fg: used > budget + 0.5 ? tone.bad : ink.figure },
      { text: ` of ${formatWholeMoney(budget)}`, fg: ink.note },
    ]
    const items = [
      ...categories.map((c) => item(c.name, c.color, c.spent, c.amount)),
      allocated > target
        ? [{ text: `categories ${formatWholeMoney(allocated - target)} over the target`, fg: tone.caution }]
        : item("the rest", targetFill(), restSpent, rest),
    ]
    let line: Span[] = []
    for (const it of items) {
      if (line.length && spansWidth(line) + 2 + spansWidth(it) > width) { legend.push(line); line = [] }
      line = line.length ? [...line, { text: "  ", fg: ink.note }, ...it] : it
    }
    if (line.length) legend.push(line)
  }
  return { above, bar, legend, targetCells }
}

/**
 * The plan for savers as a meter `width` wide, all of it the plan, ordered
 * as the pay bar's savers end it opens out: what spending past the target
 * has taken from it first (hatched in bad), then what's gone to savers
 * (good) and what's still to send (a dim good). Sent fills at most what's
 * left of the plan; its figure is all of it. Under it each part's figure
 * where it fits.
 */
export function saversMeter(width: number, plan: number, sent: number, short: number): { bar: Span[]; labels: Span[] } {
  const available = Math.max(0, plan - short)
  const shown = Math.min(sent, available)
  const toSend = available - shown
  const { bar, labels } = flowBar(width, [
    { amount: short, color: tone.bad, hatch: true, label: [[money(short, tone.bad), { text: " short", fg: tone.bad }], [money(short, tone.bad)]] },
    { amount: shown, color: tone.good, label: [[money(sent, tone.good), { text: " sent", fg: ink.note }], [money(sent, tone.good)]] },
    { amount: toSend, color: fade(tone.good, LEFT_FADE), label: [[money(toSend, ink.figure), { text: " to send", fg: ink.note }], [money(toSend, ink.figure)]] },
  ])
  return { bar, labels }
}

/** How much a part's colour fades for what's left of it. */
const LEFT_FADE = 0.65

/**
 * The cycle as a track `width` wide, from its payday (●) to the next (○):
 * the days gone solid, today marked in today's colour, the days to come
 * dotted, and each send to savers on its day. Over it what came in,
 * what's gone to savers and what's been spent (over today, where there's
 * room); under it the two paydays' dates, today and each send's.
 *
 * Over any span (the Overview's Date Range): `end` labels the right end
 * (else the next payday), and the paydays inside it are ●. Marks that
 * would crowd (a year's sends) aren't drawn: the sends first, then the
 * paydays; the figures under it are the whole span's either way.
 */
export function cycleTrack(width: number, start: string, next: string, today: string, pay: { pay: number; sent: number; spent: number; sends: Array<{ dateISO: string }>; paydays?: string[] }, sentColor: string, end?: string): Span[][] {
  const days = Math.max(1, daysBetween(start, next))
  const col = (date: string) => Math.max(0, Math.min(width - 1, Math.round((daysBetween(start, date) / days) * (width - 1))))
  const now = today >= start && today < next ? col(today) : today >= next ? width : -1
  const roomy = (n: number) => n <= Math.floor(width / 4)
  const sends = roomy(pay.sends.length) ? pay.sends : []
  const paydays = (pay.paydays ?? []).filter((d) => d > start && d < next)
  const sendCols = new Set(sends.map((s) => col(s.dateISO)))
  const payCols = new Set(roomy(paydays.length) ? paydays.map(col) : [])
  const track: Span[] = []
  for (let c = 0; c < width; c++) {
    const span: Span = c === 0 ? { text: "●", fg: ink.figure }
      : c === width - 1 ? { text: "○", fg: ink.label }
      : c === now ? { text: "┿", fg: theme.chartToday, bold: true }
      : sendCols.has(c) ? { text: "◆", fg: sentColor }
      : payCols.has(c) ? { text: "●", fg: ink.figure }
      : c < now ? { text: "━", fg: LEVEL_BG[2] ?? theme.surface1 }
      : { text: "┄", fg: ink.faint }
    const last = track.at(-1)
    if (last && last.fg === span.fg && !last.bold === !span.bold) last.text += span.text
    else track.push(span)
  }
  // The paydays and today first; each send's date over it where there's
  // room (its day alone, where the month is the start's).
  // A span across years (a year's range) gives each end its year.
  const endDate = end ?? next
  const years = start.slice(0, 4) !== endDate.slice(0, 4)
  const dated = (d: string) => (years ? `${shortDate(d)} ${d.slice(0, 4)}` : shortDate(d))
  const nextLabel = dated(endDate)
  const labels = labelled(width, [
    { at: 0, options: [[{ text: dated(start), fg: ink.label }]] },
    { at: width - nextLabel.length, options: [[{ text: nextLabel, fg: ink.label }]] },
    ...(now >= 0 && now < width ? [{ mid: now + 0.5, options: [[{ text: "today", fg: theme.chartToday }]] }] : []),
    ...sends.map((s) => ({ mid: col(s.dateISO) + 0.5, options: [[{ text: shortDate(s.dateISO), fg: ink.note }], [{ text: String(Number(s.dateISO.slice(8, 10))), fg: ink.note }]] })),
  ])
  // Under it what came in, what's gone to savers from the first send, and
  // what's been spent, centred under today but clear of the others.
  const firstSend = sends[0] ?? (pay.sent > 0.5 ? { dateISO: start } : undefined)
  // Each figure in words where they all fit, else bare (savers' first,
  // then what came in's), so what's spent always has its place.
  const spentSpans: Span[] = [{ text: formatWholeMoney(pay.spent), fg: tone.bad }, { text: " spent", fg: ink.note }]
  const inSpans = (words: boolean): Span[] => (pay.pay > 0 ? [{ text: "↓ ", fg: ink.note }, { text: formatWholeMoney(pay.pay), fg: ink.figure }, ...(words ? [{ text: " in", fg: ink.note }] : [])] : [])
  const sentSpans = (words: boolean): Span[] => (firstSend ? [{ text: "◆ ", fg: sentColor }, { text: formatWholeMoney(pay.sent), fg: sentColor }, ...(words ? [{ text: " savers", fg: ink.note }] : [])] : [])
  const room = (a: Span[], b: Span[]) => [a, b, pay.spent > 0 ? spentSpans : []].filter((x) => x.length).reduce((n, x) => n + spansWidth(x) + 2, -2) <= width
  const [inFig, sentFig] = room(inSpans(true), sentSpans(true)) ? [inSpans(true), sentSpans(true)]
    : room(inSpans(true), sentSpans(false)) ? [inSpans(true), sentSpans(false)] : [inSpans(false), sentSpans(false)]
  const inEnd = inFig.length ? spansWidth(inFig) + 2 : 0
  const spentW = pay.spent > 0 ? spansWidth(spentSpans) + 2 : 0
  // Savers from its send's column, but never so far that spent has no room.
  const sentAt = firstSend ? Math.max(inEnd, Math.min(col(firstSend.dateISO), width - spansWidth(sentFig) - spentW)) : 0
  const after = sentFig.length ? sentAt + spansWidth(sentFig) + 2 : inEnd
  const figures = labelled(width, [
    ...(inFig.length ? [{ at: 0, options: [inFig] }] : []),
    ...(sentFig.length ? [{ at: sentAt, options: [sentFig] }] : []),
    // Under today where there's room.
    ...(pay.spent > 0 ? [{ at: Math.max(after, Math.round((now >= 0 ? Math.min(now, width - 1) : width - 1) + 0.5 - spansWidth(spentSpans) / 2)), options: [spentSpans] }] : []),
  ])
  // The figures over the track, the dates under it.
  return [figures, track, labels]
}
