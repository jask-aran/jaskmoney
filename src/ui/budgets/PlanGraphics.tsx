import { Index, Show } from "solid-js"
import { formatWholeMoney } from "../../domain/dashboard"
import { daysBetween } from "../../domain/days"
import { fade, ink, theme, tone } from "../../theme"
import { LEVEL_BG } from "../overview/CalendarView"
import { shortDate, truncate } from "../text"
import { S } from "../primitives/S"
import type { Span } from "../primitives/spans"

/**
 * The Budgets pane's pictures of the plan and the cycle: the payday tiles
 * (flat fills, as the calendar's days), each pay as one bar (where it
 * goes: the category budgets, the rest of the spending target, savers),
 * the plan for savers as a meter, and the cycle as a track from payday to
 * payday. Pure builders, but for the tiles.
 */

/** The target's colour: the charts' Budget line's, so the target reads
 * the same in the bar as on the chart. */
const targetFill = () => theme.chartBudget

/** One part of each pay: a category's budget, the rest of the target, savers. */
export interface PayPart { name: string; amount: number; color: string; spent: number }

/** Cells for each part across `width`, from the running total so the
 * rounding never shortens the whole. */
function cellsOf(amounts: number[], width: number): number[] {
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
const hatched = (cells: number, fg: string, base: string): Span => ({ text: HATCH.repeat(cells), fg, bg: fade(base, 0.7) })

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
  const runs: Array<{ amount: number; color: string; part: "target" | "over" | "savers" }> = [
    ...categories.flatMap((c) => [
      { amount: Math.min(c.spent, c.amount), color: c.color, part: "target" as const },
      { amount: c.amount - Math.min(c.spent, c.amount), color: fade(c.color, LEFT_FADE), part: "target" as const },
    ]),
    { amount: restFilled, color: targetFill(), part: "target" },
    { amount: rest - restFilled, color: fade(targetFill(), LEFT_FADE), part: "target" },
    { amount: over, color: tone.bad, part: "over" },
    { amount: saved, color: tone.good, part: "savers" },
  ]
  const cells = cellsOf(runs.map((r) => r.amount), width)
  const bar: Span[] = runs.flatMap((r, i): Span[] => (cells[i]! <= 0 ? [] : r.part === "over" ? [hatched(cells[i]!, r.color, r.color)] : [{ text: "█".repeat(cells[i]!), fg: r.color }]))
  const targetCells = runs.reduce((n, r, i) => n + (r.part === "target" ? cells[i]! : 0), 0)
  const overCells = runs.reduce((n, r, i) => n + (r.part === "over" ? cells[i]! : 0), 0)
  // Over the bar: the target over its part, how far over over the hatching,
  // and what's left of the pay over the rest (left of the target, with no
  // pay). The target and how far over first, where room is short.
  const total = runs.reduce((n, r) => n + Math.max(0, r.amount), 0)
  const spentCells = total > 0 ? Math.min(width, Math.round((Math.min(spent, total) / total) * width)) : 0
  const left = (pay ?? target) - spent
  const money = (n: number, fg: string): Span => ({ text: formatWholeMoney(n), fg, bold: true })
  const above = labelled(width, [
    // With no pay the target is the whole bar: what's spent of it instead.
    ...(pay == null ? [{ mid: spentCells / 2, options: [[money(spent, over > 0 ? tone.bad : ink.figure), { text: " spent", fg: ink.note }], [money(spent, ink.figure)]] }]
      : targetCells > 0 ? [{ mid: targetCells / 2, options: [[money(target, ink.figure), { text: " target", fg: ink.note }], [money(target, ink.figure)]] }] : []),
    ...(overCells > 0 ? [{ mid: targetCells + overCells / 2, options: [[money(over, tone.bad), { text: " over", fg: tone.bad }], [money(over, tone.bad)]] }] : []),
    ...(left > 0.5 && width - spentCells > 0 ? [{ mid: (spentCells + width) / 2, options: [[money(left, ink.figure), { text: " left", fg: ink.note }], [money(left, ink.figure)]] }] : []),
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
 * Under the pay bar, the line that opens its savers end (from `from` to
 * the end) out to the full width for Savers' meter under it: a corner
 * under where savers start, running back to the left edge, the right edge
 * straight down, and the plan between.
 */
export function planOpening(width: number, from: number, plan: number): Span[] {
  if (from <= 0 || from >= width - 1) return [{ text: " ", fg: ink.note }]
  const label: Span[] = [{ text: "savers plan ", fg: ink.note }, { text: formatWholeMoney(plan), fg: ink.figure, bold: true }]
  const room = width - 1 - (from + 1)
  const fits = spansWidth(label) + 2 <= room
  const pad = fits ? room - spansWidth(label) : room
  const leftPad = Math.floor(pad / 2)
  return [
    { text: `╭${"─".repeat(from - 1)}╯`, fg: ink.rule },
    { text: " ".repeat(fits ? leftPad : room), fg: ink.note },
    ...(fits ? [...label, { text: " ".repeat(pad - leftPad), fg: ink.note }] : []),
    { text: "│", fg: ink.rule },
  ]
}

/**
 * The plan for savers as a meter `width` wide, all of it the plan, ordered
 * as the pay bar's savers end it opens out: what spending past the target
 * has taken from it first (hatched in bad), then what's gone to savers
 * (good) and what's still to send (a dim good). Sent past what's left of
 * the plan runs back over what's short, hatched in good: sent from money
 * the spending needed. Under it each part's figure where it fits.
 */
export function saversMeter(width: number, plan: number, sent: number, short: number): { bar: Span[]; labels: Span[]; oversent: number } {
  const available = Math.max(0, plan - short)
  const oversent = Math.max(0, sent - available)
  const sentFrom = oversent > 0 ? Math.max(0, plan - sent) : short
  const sentTo = Math.min(plan, sentFrom + sent)
  const toSend = Math.max(0, plan - sentTo)
  // Each cell by what its middle falls in.
  const kind = (c: number) => {
    const x = ((c + 0.5) / width) * plan
    const inShort = x < short, inSent = x >= sentFrom && x < sentTo
    return inShort && inSent ? "both" : inShort ? "short" : inSent ? "sent" : "send"
  }
  const bar: Span[] = []
  const counts: Record<string, { from: number; cells: number }> = {}
  for (let c = 0; c < width; c++) {
    const k = kind(c)
    counts[k] = counts[k] ? { ...counts[k]!, cells: counts[k]!.cells + 1 } : { from: c, cells: 1 }
    const span: Span = k === "short" ? hatched(1, tone.bad, tone.bad) : k === "both" ? hatched(1, tone.good, tone.bad) : { text: "█", fg: k === "sent" ? tone.good : fade(tone.good, LEFT_FADE) }
    const last = bar.at(-1)
    if (last && last.fg === span.fg && last.bg === span.bg) last.text += span.text
    else bar.push(span)
  }
  const at = (k: string) => (counts[k] ? counts[k]!.from + counts[k]!.cells / 2 : null)
  const shortMid = at("short") ?? at("both"), sentMid = counts.sent ? counts.sent.from + (counts.sent.cells + (counts.both?.cells ?? 0)) / 2 - (counts.both?.cells ?? 0) : null
  const money = (n: number, fg: string): Span => ({ text: formatWholeMoney(n), fg, bold: true })
  const labels = labelled(width, [
    ...(short > 0.5 && shortMid != null ? [{ mid: shortMid, options: [[money(short, tone.bad), { text: " short", fg: tone.bad }], [money(short, tone.bad)]] }] : []),
    ...(sent > 0.5 && sentMid != null ? [{ mid: sentMid, options: [[money(sent, tone.good), { text: " sent", fg: ink.note }], [money(sent, tone.good)]] }] : []),
    ...(toSend > 0.5 && counts.send ? [{ mid: at("send")!, options: [[money(toSend, ink.figure), { text: " to send", fg: ink.note }], [money(toSend, ink.figure)]] }] : []),
  ])
  return { bar, labels, oversent }
}

/** A label for `labelled`: its options, best first, placed from `at`
 * or centred on `mid`. */
interface Label { at?: number; mid?: number; options: Span[][] }

/** Labels on a line `width` wide, in priority order: each takes its first
 * option that fits where it goes (kept on the line) without touching one
 * already placed, else is dropped. */
function labelled(width: number, labels: Label[]): Span[] {
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

const spansWidth = (spans: Span[]) => spans.reduce((n, l) => n + l.text.length, 0)

/** How much a part's colour fades for what's left of it. */
const LEFT_FADE = 0.65

/**
 * The cycle as a track `width` wide, from its payday (●) to the next (○):
 * the days gone solid, today marked in today's colour, the days to come
 * dotted, and each send to savers on its day. Above it the two paydays'
 * dates, today and each send's; under it what came in and what's gone to
 * savers.
 */
export function cycleTrack(width: number, start: string, next: string, today: string, pay: { pay: number; sent: number; sends: Array<{ dateISO: string }> }, sentColor: string): Span[][] {
  const days = Math.max(1, daysBetween(start, next))
  const col = (date: string) => Math.max(0, Math.min(width - 1, Math.round((daysBetween(start, date) / days) * (width - 1))))
  const now = today >= start && today < next ? col(today) : today >= next ? width : -1
  const sendCols = new Set(pay.sends.map((s) => col(s.dateISO)))
  const track: Span[] = []
  for (let c = 0; c < width; c++) {
    const span: Span = c === 0 ? { text: "●", fg: ink.figure }
      : c === width - 1 ? { text: "○", fg: ink.label }
      : c === now ? { text: "┿", fg: theme.chartToday, bold: true }
      : sendCols.has(c) ? { text: "◆", fg: sentColor }
      : c < now ? { text: "━", fg: LEVEL_BG[2] ?? theme.surface1 }
      : { text: "┄", fg: ink.faint }
    const last = track.at(-1)
    if (last && last.fg === span.fg && !last.bold === !span.bold) last.text += span.text
    else track.push(span)
  }
  // The paydays and today first; each send's date over it where there's
  // room (its day alone, where the month is the start's).
  const nextLabel = shortDate(next)
  const labels = labelled(width, [
    { at: 0, options: [[{ text: shortDate(start), fg: ink.label }]] },
    { at: width - nextLabel.length, options: [[{ text: nextLabel, fg: ink.label }]] },
    ...(now >= 0 && now < width ? [{ mid: now + 0.5, options: [[{ text: "today", fg: theme.chartToday }]] }] : []),
    ...pay.sends.map((s) => ({ mid: col(s.dateISO) + 0.5, options: [[{ text: shortDate(s.dateISO), fg: ink.note }], [{ text: String(Number(s.dateISO.slice(8, 10))), fg: ink.note }]] })),
  ])
  // Under it what came in, and what's gone to savers from the first send.
  const firstSend = pay.sends[0]
  const figures = labelled(width, [
    ...(pay.pay > 0 ? [{ at: 0, options: [[{ text: "↓ ", fg: ink.note }, { text: formatWholeMoney(pay.pay), fg: ink.figure }, { text: " in", fg: ink.note }]] }] : []),
    // From its send's column, or just past what came in.
    ...(firstSend ? [{ at: Math.max(col(firstSend.dateISO), pay.pay > 0 ? `↓ ${formatWholeMoney(pay.pay)} in`.length + 2 : 0), options: [
      [{ text: "◆ ", fg: sentColor }, { text: formatWholeMoney(pay.sent), fg: sentColor }, { text: " to savers", fg: ink.note }],
      [{ text: "◆ ", fg: sentColor }, { text: formatWholeMoney(pay.sent), fg: sentColor }],
    ] }] : []),
  ])
  return [labels, track, figures]
}

/** Digits drawn in light, rounded box-drawing lines, three cells wide
 * and three lines high: strokes, not blocks, so a number sits lightly on
 * its tile (a seven-segment look). */
const DIGITS: Record<string, [string, string, string]> = {
  "0": ["╭─╮", "│ │", "╰─╯"], "1": ["╶╮ ", " │ ", "╶┴╴"],
  "2": ["╭─╮", "╭─╯", "╰─╴"], "3": ["╭─╮", "╶─┤", "╰─╯"],
  "4": ["╷ ╷", "╰─┤", "  ╵"], "5": ["╭─╴", "╰─╮", "╶─╯"],
  "6": ["╭─╴", "├─╮", "╰─╯"], "7": ["╶─╮", "  │", "  ╵"],
  "8": ["╭─╮", "├─┤", "╰─╯"], "9": ["╭─╮", "╰─┤", "╶─╯"],
}

/** A number drawn large: its digits' three lines, a column between
 * digits. */
export function bigDigits(value: string): [string, string, string] {
  const lines: [string, string, string] = ["", "", ""]
  const digits = [...value].flatMap((d) => (DIGITS[d] ? [DIGITS[d]!] : []))
  digits.forEach((glyph, n) => {
    for (let line = 0; line < 3; line++) lines[line] += (n ? " " : "") + glyph[line]
  })
  return lines
}

/**
 * The payday tiles, flat grey fills as the calendar's empty days, `width`
 * wide in all: what changes day to day, its number drawn large under its
 * label. Next payday (its day of the month; the month and weekday
 * beside), the days to it, and what's left of the target a day till then
 * ($0 once it's spent: how far over is Each pay's to say; with no target,
 * which key sets one).
 */
export function PaydayTiles(props: { width: number; next: string; today: string; perDay: { remaining: number; daily: number } | null }) {
  const tile = () => Math.floor((props.width - 2) / 3)
  const days = () => Math.max(0, daysBetween(props.today, props.next))
  const month = () => new Date(props.next + "T12:00:00Z").toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" })
  // The weekday in full where it fits beside the date, else short.
  const weekday = () => {
    const long = new Date(props.next + "T12:00:00Z").toLocaleDateString("en-AU", { weekday: "long", timeZone: "UTC" })
    const room = tile() - 1 - bigDigits(String(Number(props.next.slice(8, 10))))[0].length - 2
    return long.length <= room ? long : long.slice(0, 3)
  }
  return (
    <box flexDirection="row" gap={1} width={props.width} height={TILE_HEIGHT} flexShrink={0}>
      <Tile width={tile()} bg={theme.surface0} label="Next payday" labelFg={ink.label} value={String(Number(props.next.slice(8, 10)))} fg={ink.strong}
        beside={[month(), weekday(), ""]} besideFg={ink.label} />
      <Tile width={tile()} bg={theme.surface0} label="Days to pay" labelFg={ink.label} value={String(days())} fg={ink.strong}
        beside={["", days() === 1 ? "day" : "days", ""]} besideFg={ink.label} />
      <Show when={props.perDay} fallback={
        <Tile width={props.width - 2 - 2 * tile()} bg={theme.surface0} label="Left per day" labelFg={ink.label} value="" fg={ink.faint}
          beside={["t sets your", "spending target", ""]} besideFg={ink.note} />
      }>
        <Tile width={props.width - 2 - 2 * tile()} bg={theme.surface0} label="Left per day" labelFg={ink.label}
          prefix="$ " value={String(Math.round(props.perDay!.daily))} fg={ink.strong} beside={["", "", ""]} besideFg={ink.label} />
      </Show>
    </box>
  )
}

/** A tile: its label, a line of fill, a number drawn large (`prefix`
 * small at its top left, as prices set the dollar sign) with words beside
 * each line, and a line of fill under. Too wide to draw large, the number
 * goes in plain bold on the middle line. */
function Tile(p: { width: number; bg: string; label: string; labelFg: string; value: string; fg: string; beside: [string, string, string]; besideFg: string; prefix?: string }) {
  const drawn = () => bigDigits(p.value)
  const fits = () => 1 + (p.prefix?.length ?? 0) + drawn()[0].length <= p.width
  const plain = () => `${p.prefix?.trim() ?? ""}${Number(p.value).toLocaleString("en-AU")}`
  const big = (): [string, string, string] => (fits() ? drawn() : ["", p.value ? plain() : "", ""])
  const lead = (i: number) => (p.prefix && fits() ? (i === 0 ? p.prefix : " ".repeat(p.prefix.length)) : "")
  const line = (parts: Array<{ text: string; fg: string; bold?: boolean }>) => (
    <text wrapMode="none" bg={p.bg}>
      <Index each={parts}>{(part) => <S fg={part().fg} bg={p.bg} bold={part().bold}>{part().text}</S>}</Index>
      <S bg={p.bg}>{" ".repeat(Math.max(0, p.width - parts.reduce((n, part) => n + part.text.length, 0)))}</S>
    </text>
  )
  return (
    <box flexDirection="column" width={p.width} height={TILE_HEIGHT} backgroundColor={p.bg}>
      {line([{ text: truncate(` ${p.label}`, p.width), fg: p.labelFg }])}
      {line([])}
      <Index each={[0, 1, 2]}>{(i) => {
        const digits = () => ` ${lead(i())}${big()[i()]}`
        return line([
          { text: truncate(digits(), p.width), fg: p.fg, bold: true },
          { text: truncate(`${big()[i()] ? "  " : ""}${p.beside[i()]}`, Math.max(0, p.width - digits().length)), fg: p.besideFg },
        ])
      }}</Index>
      {line([])}
    </box>
  )
}

/** The tiles' height: a label, a line of fill, three lines of big digits,
 * a line of fill. */
export const TILE_HEIGHT = 6
