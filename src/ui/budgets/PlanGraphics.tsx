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
 * bad, between the target and savers: it comes out of what savers get.
 * Then savers, what's left of the pay, in good. With no pay set, there are
 * no savers. Above the bar a tick where the target ends, with the target;
 * under it what's spent and what's left (of the pay, or of the target),
 * then the categories' legend, spent of budget.
 */
export function payBar(width: number, pay: number | null, target: number, categories: PayPart[], restSpent: number): { lines: Span[][]; targetCells: number; overCells: number } {
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
    { amount: restFilled, color: spendingFill(), part: "target" },
    { amount: rest - restFilled, color: fade(spendingFill(), LEFT_FADE), part: "target" },
    { amount: over, color: tone.bad, part: "over" },
    { amount: saved, color: tone.good, part: "savers" },
  ]
  const cells = cellsOf(runs.map((r) => r.amount), width)
  const bar: Span[] = runs.flatMap((r, i): Span[] => (cells[i]! > 0 ? [{ text: "█".repeat(cells[i]!), fg: r.color }] : []))
  const targetCells = runs.reduce((n, r, i) => n + (r.part === "target" ? cells[i]! : 0), 0)
  const overCells = runs.reduce((n, r, i) => n + (r.part === "over" ? cells[i]! : 0), 0)
  const out: Span[][] = []
  // The target's end, marked over its last cell (none when the target is
  // all the bar: nothing beyond it to tell apart).
  if (targetCells > 0 && targetCells < width) out.push(marker(width, targetCells - 1, "▾", [{ text: "target ", fg: ink.label }, { text: formatWholeMoney(target), fg: ink.figure }], ink.label))
  out.push(bar)
  // Under it, what's spent centred under spending's share of the bar, and
  // what's left (of the pay, or with none, of the target) under the rest.
  const total = runs.reduce((n, r) => n + Math.max(0, r.amount), 0)
  if (total > 0) {
    const spentCells = Math.min(width, Math.round((Math.min(spent, total) / total) * width))
    const remaining = (pay ?? target) - spent
    const spentFg = over > 0 ? tone.bad : ink.figure
    const spentText = spent > 0.5 ? `−${formatWholeMoney(spent)}` : formatWholeMoney(0)
    const remainingText = remaining < -0.5 ? `−${formatWholeMoney(-remaining)}` : formatWholeMoney(Math.max(0, remaining))
    const remainingFg = remaining < -0.5 ? tone.bad : ink.figure
    out.push(labelled(width, [
      { mid: spentCells / 2, options: [[{ text: spentText, fg: spentFg, bold: true }, { text: " spent", fg: ink.note }], [{ text: spentText, fg: spentFg, bold: true }]] },
      { mid: (spentCells + width) / 2, options: [[{ text: remainingText, fg: remainingFg, bold: true }, { text: " left", fg: ink.note }], [{ text: remainingText, fg: remainingFg, bold: true }]] },
    ]))
  }
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
      if (line.length && spansWidth(line) + 2 + spansWidth(it) > width) { out.push(line); line = [] }
      line = line.length ? [...line, { text: "  ", fg: ink.note }, ...it] : it
    }
    if (line.length) out.push(line)
  }
  return { lines: out, targetCells, overCells }
}

/**
 * The plan for savers as a meter on the pay bar's scale, `width` wide,
 * under the bar's savers end: blank for the `from` cells the target takes,
 * then what spending past the target has taken from the plan (bad, its
 * `shortCells` the bar's overspend, so the two line up), what's gone to
 * savers (good) and what's still to send (a dim good). Each part's figure
 * goes centred over it where it fits.
 */
export function saversMeter(width: number, from: number, shortCells: number, sent: number, toSend: number, short: number): Span[][] {
  const region = Math.max(0, width - from)
  const short_ = Math.min(region, shortCells)
  // What's sent beyond what's left of the plan still only fills it.
  const [sentCells, sendCells] = cellsOf([sent, toSend], region - short_)
  const runs = [
    { cells: short_, color: tone.bad, labels: [[{ text: formatWholeMoney(short), fg: tone.bad, bold: true }, { text: " short", fg: tone.bad }], [{ text: formatWholeMoney(short), fg: tone.bad, bold: true }]] },
    { cells: sentCells!, color: tone.good, labels: [[{ text: formatWholeMoney(sent), fg: tone.good, bold: true }, { text: " sent", fg: ink.note }], [{ text: formatWholeMoney(sent), fg: tone.good, bold: true }]] },
    { cells: sendCells!, color: fade(tone.good, LEFT_FADE), labels: [[{ text: formatWholeMoney(toSend), fg: ink.figure }, { text: " to send", fg: ink.note }], [{ text: formatWholeMoney(toSend), fg: ink.figure }]] },
  ]
  const bar: Span[] = [
    ...(from > 0 ? [{ text: " ".repeat(Math.min(width, from)), fg: ink.note }] : []),
    ...runs.flatMap((r): Span[] => (r.cells > 0 ? [{ text: "█".repeat(r.cells), fg: r.color }] : [])),
  ]
  if (runs.every((r) => r.cells === 0) && region > 0) bar.push({ text: "─".repeat(region), fg: ink.rule })
  // Short first, then sent, then what's to send, where room is left.
  let at = from
  const mids = runs.map((r) => { const mid = at + r.cells / 2; at += r.cells; return mid })
  const labels = runs.flatMap((r, i) => (r.cells > 0 ? [{ mid: mids[i]!, options: r.labels as Span[][] }] : []))
  return [labelled(width, labels), bar]
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

/** A mark at column `at` of a line `width` wide, its label after it, or
 * before it where it would run off the end. */
function marker(width: number, at: number, mark: string, label: Span[], fg: string): Span[] {
  const w = spansWidth(label) + 2
  const before = at + w > width
  const from = before ? Math.max(0, at - w + 1) : at
  const body: Span[] = before ? [...label, { text: " ", fg }, { text: mark, fg, bold: true }] : [{ text: mark, fg, bold: true }, { text: " ", fg }, ...label]
  return [...(from ? [{ text: " ".repeat(from), fg: ink.note }] : []), ...body]
}

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
      : c < now ? { text: "━", fg: spendingFill() }
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
