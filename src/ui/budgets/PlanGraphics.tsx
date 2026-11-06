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
 * the cycle as a track from payday to payday, and a meter of what's gone
 * to savers against the plan. Pure builders, but for the tiles.
 */

/** Spending's colour here: the calendar's middle level (LEVEL_BG follows
 * the theme). */
const spendingFill = () => LEVEL_BG[2] ?? theme.surface1

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

/**
 * Each pay as one bar `width` wide, filling as the cycle's spending comes
 * in. The target first: each category budget in its colour, then the rest
 * of the target in spending's, each solid for what's spent against it and
 * a dim shade of its colour for what's left (a category over its budget
 * takes the excess from the rest). Spending past the target is drawn in
 * bad, between the target and savers: it comes out of what savers get,
 * as the next top-up keeps that much more of the pay. Then savers, what's
 * left of the pay, in good. Past the pay too, the bar is the spending.
 * Under it two brackets: spending (over the target and any overspend:
 * what's spent of the target, and what's left or how far over) and
 * savers; then the categories' legend, spent of budget. With no pay set,
 * there are no savers.
 */
export function payBar(width: number, pay: number | null, target: number, categories: PayPart[], restSpent: number): Span[][] {
  const allocated = categories.reduce((n, c) => n + c.amount, 0)
  const rest = Math.max(0, target - allocated)
  const spent = categories.reduce((n, c) => n + c.spent, 0) + restSpent
  const excess = categories.reduce((n, c) => n + Math.max(0, c.spent - c.amount), 0)
  const restFilled = Math.min(rest, restSpent + excess)
  const over = Math.max(0, spent - Math.max(target, allocated))
  const saved = pay != null ? Math.max(0, pay - Math.max(target, allocated) - over) : 0
  // Each part's spent and left, in that order, as runs of the bar.
  const runs: Array<{ amount: number; color: string; part: "target" | "over" | "savers" }> = [
    ...categories.flatMap((c) => [
      { amount: Math.min(c.spent, c.amount), color: c.color, part: "target" as const },
      { amount: c.amount - Math.min(c.spent, c.amount), color: fade(c.color, LEFT_FADE), part: "target" as const },
    ]),
    { amount: restFilled, color: spendingFill(), part: "target" },
    { amount: rest - restFilled, color: fade(spendingFill(), LEFT_FADE), part: "target" },
    { amount: over, color: tone.bad, part: "over" },
    { amount: saved, color: tone.good, part: "savers" },
  ]
  const cells = cellsOf(runs.map((r) => r.amount), width)
  const bar: Span[] = runs.flatMap((r, i): Span[] => (cells[i]! > 0 ? [{ text: "█".repeat(cells[i]!), fg: r.color }] : []))
  const cellsIn = (part: string) => runs.reduce((n, r, i) => n + (r.part === part ? cells[i]! : 0), 0)
  // A part's bracket: the first label that fits between its corners;
  // else the first that fits bare, centred; else blank.
  const width_ = (spans: Span[]) => spans.reduce((n, l) => n + l.text.length, 0)
  const bracket = (cellsWide: number, labels: Span[][]): Span[] => {
    if (cellsWide < 1) return []
    const inside = labels.find((l) => width_(l) + 4 <= cellsWide)
    if (inside) {
      const room = cellsWide - 4 - width_(inside), left = Math.floor(room / 2)
      return [{ text: `└${"─".repeat(left)} `, fg: ink.rule }, ...inside, { text: ` ${"─".repeat(room - left)}┘`, fg: ink.rule }]
    }
    const bare = labels.find((l) => width_(l) + 2 <= cellsWide)
    if (!bare) return [{ text: " ".repeat(cellsWide), fg: ink.rule }]
    const room = cellsWide - width_(bare), left = Math.floor(room / 2)
    return [{ text: " ".repeat(left), fg: ink.rule }, ...bare, { text: " ".repeat(room - left), fg: ink.rule }]
  }
  const money = (text: string, fg: string = ink.figure): Span => ({ text, fg })
  // Spending's bracket spans the target and any overspend: what's spent of
  // the target and what's left, or how far over; savers have their own.
  const of = [{ text: " of ", fg: ink.note }, money(formatWholeMoney(target))]
  const slash = [{ text: "/", fg: ink.note }, money(formatWholeMoney(target))]
  const dot: Span = { text: " · ", fg: ink.note }
  const spendLabels: Span[][] = over > 0
    ? [
      [money(formatWholeMoney(spent)), ...of, dot, money(`${formatWholeMoney(over)} over`, tone.bad)],
      [money(formatWholeMoney(spent)), ...slash, dot, money(`${formatWholeMoney(over)} over`, tone.bad)],
      [money(formatWholeMoney(spent)), dot, money(`${formatWholeMoney(over)} over`, tone.bad)],
      [money(`${formatWholeMoney(over)} over`, tone.bad)],
      [money(`+${formatWholeMoney(over)}`, tone.bad)],
    ]
    : [
      [money(formatWholeMoney(spent)), ...of, dot, money(`${formatWholeMoney(target - spent)} left`)],
      [money(formatWholeMoney(spent)), ...slash, dot, money(`${formatWholeMoney(target - spent)} left`)],
      [money(formatWholeMoney(spent)), ...of],
      [money(`${formatWholeMoney(target - spent)} left`)],
      [money(formatWholeMoney(target - spent))],
    ]
  const brackets: Span[] = [
    ...bracket(cellsIn("target") + cellsIn("over"), spendLabels),
    ...bracket(cellsIn("savers"), [[{ text: "savers ", fg: ink.label }, money(formatWholeMoney(saved))], [money(formatWholeMoney(saved))]]),
  ]
  const out = [bar, brackets]
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
        : item("the rest", spendingFill(), restSpent, rest),
    ]
    let line: Span[] = []
    for (const it of items) {
      if (line.length && width_(line) + 2 + width_(it) > width) { out.push(line); line = [] }
      line = line.length ? [...line, { text: "  ", fg: ink.note }, ...it] : it
    }
    if (line.length) out.push(line)
  }
  return out
}

/** How much a part's colour fades for what's left of it. */
const LEFT_FADE = 0.65

/** Place `items` on a line `width` wide, each at its column or just past
 * the one before (never overlapping, dropping what won't fit). */
function placed(width: number, items: Array<{ at: number; spans: Span[] }>): Span[] {
  const out: Span[] = []
  let col = 0
  for (const item of items) {
    const w = item.spans.reduce((n, s) => n + s.text.length, 0)
    const at = Math.max(col + (col ? 1 : 0), Math.min(item.at, width - w))
    if (at + w > width) continue
    if (at > col) out.push({ text: " ".repeat(at - col), fg: ink.note })
    out.push(...item.spans)
    col = at + w
  }
  return out
}

/**
 * The cycle as a track `width` wide, from its payday (●) to the next (○):
 * the days gone solid, today marked in today's colour, the days to come
 * dotted, and each send to savers on its day. Above it the two paydays'
 * dates and today; under it what came in and what's gone to savers.
 */
export function cycleTrack(width: number, start: string, next: string, today: string, pay: { dateISO: string | null; pay: number; sent: number; sends: Array<{ dateISO: string }> }, sentColor: string): Span[][] {
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
      : c < now ? { text: "━", fg: spendingFill() }
      : { text: "┄", fg: ink.faint }
    const last = track.at(-1)
    if (last && last.fg === span.fg && !last.bold === !span.bold) last.text += span.text
    else track.push(span)
  }
  const nextLabel = shortDate(next)
  const labels = placed(width, [
    { at: 0, spans: [{ text: shortDate(start), fg: ink.label }] },
    ...(now >= 0 && now < width ? [{ at: now - 2, spans: [{ text: "today", fg: theme.chartToday }] }] : []),
    { at: width - nextLabel.length, spans: [{ text: nextLabel, fg: ink.label }] },
  ])
  const firstSend = pay.sends[0]
  const figures = placed(width, [
    ...(pay.pay > 0 ? [{ at: 0, spans: [{ text: "↓ ", fg: ink.note }, { text: formatWholeMoney(pay.pay), fg: ink.figure }, { text: " in", fg: ink.note }] }] : []),
    ...(firstSend ? [{ at: col(firstSend.dateISO), spans: [{ text: "◆ ", fg: sentColor }, { text: formatWholeMoney(pay.sent), fg: sentColor }, { text: " to savers", fg: ink.note }] }] : []),
  ])
  return [labels, track, figures]
}

/** What's gone to savers against the plan, `width` wide: filled in good
 * once it's all gone, else caution; the rest a rule. */
export function sentMeter(width: number, sent: number, planned: number): Span[] {
  const share = planned > 0 ? Math.max(0, Math.min(1, sent / planned)) : 0
  const filled = Math.round(share * width)
  const met = sent >= planned - 1
  return [
    ...(filled ? [{ text: "█".repeat(filled), fg: met ? tone.good : tone.caution }] : []),
    ...(width - filled ? [{ text: "─".repeat(width - filled), fg: ink.rule }] : []),
  ]
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
