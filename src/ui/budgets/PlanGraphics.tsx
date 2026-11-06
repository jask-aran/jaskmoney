import { Index } from "solid-js"
import { formatWholeMoney } from "../../domain/dashboard"
import { daysBetween } from "../../domain/days"
import { ink, theme, tone } from "../../theme"
import { LEVEL_BG } from "../overview/CalendarView"
import { fit, shortDate } from "../text"
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
export interface PayPart { name: string; amount: number; color: string }

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
 * Each pay as one bar `width` wide: the category budgets in their colours
 * and the rest of the target in spending's, together the overall spending
 * target; then savers, what's left of the pay. Under it, a bracket a side
 * naming the target and savers' share; then the categories' legend. With
 * no pay set, the bar is the target alone.
 */
export function payBar(width: number, pay: number | null, target: number, categories: PayPart[]): Span[][] {
  const allocated = categories.reduce((n, c) => n + c.amount, 0)
  const rest = Math.max(0, target - allocated)
  const saved = pay != null ? Math.max(0, pay - Math.max(target, allocated)) : 0
  const parts: PayPart[] = [...categories, { name: "the rest", amount: rest, color: spendingFill() }, ...(saved > 0 ? [{ name: "savers", amount: saved, color: tone.good }] : [])]
  const cells = cellsOf(parts.map((p) => p.amount), width)
  const bar: Span[] = parts.flatMap((p, i): Span[] => (cells[i]! > 0 ? [{ text: "█".repeat(cells[i]!), fg: p.color }] : []))
  // The brackets: the spending target's cells, then savers'.
  const targetCells = cells.slice(0, categories.length + 1).reduce((n, c) => n + c, 0)
  const bracket = (cellsWide: number, label: string, amount: string): Span[] => {
    const text = ` ${label} ${amount} `
    if (cellsWide < 2) return cellsWide ? [{ text: " ", fg: ink.rule }] : []
    if (cellsWide < text.length + 2) return [{ text: fit(` ${amount}`, cellsWide), fg: ink.label }]
    const left = Math.floor((cellsWide - 2 - text.length) / 2), right = cellsWide - 2 - text.length - left
    return [
      { text: `└${"─".repeat(left)}`, fg: ink.rule },
      { text: ` ${label} `, fg: ink.label },
      { text: `${amount} `, fg: ink.figure },
      { text: `${"─".repeat(right)}┘`, fg: ink.rule },
    ]
  }
  const over = allocated > target
  const brackets: Span[] = [
    ...bracket(targetCells, "target", formatWholeMoney(target)),
    ...(saved > 0 ? bracket(width - targetCells, "savers", formatWholeMoney(saved)) : []),
  ]
  const lines = [bar, brackets]
  if (categories.length) {
    lines.push([
      ...categories.flatMap((c, i): Span[] => [{ text: `${i ? "  " : ""}■ `, fg: c.color }, { text: `${c.name} `, fg: ink.label }, { text: formatWholeMoney(c.amount), fg: ink.figure }]),
      over
        ? { text: `  ${formatWholeMoney(allocated - target)} over the target`, fg: tone.caution }
        : { text: "  ■ ", fg: spendingFill() },
      ...(over ? [] : [{ text: "the rest ", fg: ink.label }, { text: formatWholeMoney(rest), fg: ink.figure }]),
    ])
  }
  return lines
}

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

/** Digits 3 pixels wide and 5 tall ("#" a pixel), drawn three lines high
 * in half blocks (bigDigits). */
const DIGITS: Record<string, string[]> = {
  "0": ["###", "#.#", "#.#", "#.#", "###"], "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["###", "..#", "###", "#..", "###"], "3": ["###", "..#", "###", "..#", "###"],
  "4": ["#.#", "#.#", "###", "..#", "..#"], "5": ["###", "#..", "###", "..#", "###"],
  "6": ["###", "#..", "###", "#.#", "###"], "7": ["###", "..#", "..#", "..#", "..#"],
  "8": ["###", "#.#", "###", "#.#", "###"], "9": ["###", "#.#", "###", "..#", "###"],
}

/** A number drawn large: three lines, each a pair of pixel rows (█ both,
 * ▀ the top, ▄ the bottom), a column between digits. */
export function bigDigits(value: string): [string, string, string] {
  const lines: [string, string, string] = ["", "", ""]
  ;[...value].forEach((d, n) => {
    const rows = DIGITS[d]
    if (!rows) return
    for (let line = 0; line < 3; line++) {
      const top = rows[line * 2]!, bottom = rows[line * 2 + 1] ?? "..."
      lines[line] += (n ? " " : "") + [0, 1, 2].map((c) => (top[c] === "#" ? (bottom[c] === "#" ? "█" : "▀") : bottom[c] === "#" ? "▄" : " ")).join("")
    }
  })
  return lines
}

/**
 * The payday tiles: flat fills, as the calendar's days, `width` wide in
 * all. Next payday, its day of the month drawn large with the month and
 * weekday beside; and the days till it, large, on spending's fill.
 */
export function PaydayTiles(props: { width: number; next: string; today: string }) {
  const tile = () => Math.floor((props.width - 1) / 2)
  const days = () => Math.max(0, daysBetween(props.today, props.next))
  const month = () => new Date(props.next + "T12:00:00Z").toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" })
  const weekday = () => new Date(props.next + "T12:00:00Z").toLocaleDateString("en-AU", { weekday: "long", timeZone: "UTC" })
  /** A tile's line: its text from the left, then words beside the digits. */
  const line = (width: number, bg: string, parts: Array<{ text: string; fg: string; bold?: boolean }>) => (
    <text wrapMode="none" bg={bg}>
      <Index each={parts}>{(p) => <S fg={p().fg} bg={bg} bold={p().bold}>{p().text}</S>}</Index>
      <S bg={bg}>{" ".repeat(Math.max(0, width - parts.reduce((n, p) => n + p.text.length, 0)))}</S>
    </text>
  )
  /** A tile: its label, then a number drawn large with words beside it. */
  const Tile = (p: { width: number; bg: string; label: string; labelFg: string; value: string; fg: string; beside: [string, string, string]; besideFg: string }) => {
    const big = () => bigDigits(p.value)
    return (
      <box flexDirection="column" width={p.width} height={TILE_HEIGHT} backgroundColor={p.bg}>
        {line(p.width, p.bg, [{ text: fit(` ${p.label}`, p.width), fg: p.labelFg }])}
        <Index each={[0, 1, 2]}>{(i) => line(p.width, p.bg, [
          { text: ` ${big()[i()]}`, fg: p.fg, bold: true },
          { text: fit(`  ${p.beside[i()]}`, Math.max(0, p.width - 1 - big()[i()].length)), fg: p.besideFg },
        ])}</Index>
      </box>
    )
  }
  return (
    <box flexDirection="row" gap={1} width={props.width} height={TILE_HEIGHT} flexShrink={0}>
      <Tile width={tile()} bg={theme.surface0} label="Next payday" labelFg={ink.label} value={String(Number(props.next.slice(8, 10)))} fg={ink.strong}
        beside={[month(), weekday(), ""]} besideFg={ink.label} />
      <Tile width={props.width - 1 - tile()} bg={spendingFill()} label="Days till pay" labelFg={theme.crust} value={String(days())} fg={theme.crust}
        beside={["", days() === 1 ? "day" : "days", ""]} besideFg={theme.crust} />
    </box>
  )
}

/** The tiles' height: a label, then three lines of big digits. */
export const TILE_HEIGHT = 4
