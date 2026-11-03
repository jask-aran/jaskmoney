import { Index, Show, createMemo } from "solid-js"
import { data } from "../../state/dataStore"
import { categoryColor, ink } from "../../theme"
import { formatWholeMoney, signedWholeMoney } from "../../domain/dashboard"
import type { MerchantRow, TrendGroup, TrendRow } from "../../domain/periodTables"
import { categoryMark } from "../icons"
import { count, fit } from "../text"
import { spendChangeColor } from "../colors"
import type { Span } from "../primitives/spans"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"

/**
 * The Overview's table views (drawn in place of a chart, like the
 * Calendar): Trends and Merchants, both over the Date Range. Merchants'
 * rows drop in, Trends' bars grow; more than fit end in "… N more"
 * (Trends: the oldest go, "N earlier" above).
 */

const heading = (text: string, width: number, left = false): StyledSpan => ({ text: left ? text.padEnd(width) : text.padStart(width), fg: ink.label, bold: true })

const TREND_LABEL = 9, TREND_TOTAL = 9
/** A Trends bar's most lines, when the pane has room. */
const BAR_LINES = 3
/** A group's colour in Trends: its category's, Other a quiet one. */
const groupColour = (g: TrendGroup) => (g.name === "Other" && g.categoryId == null && !g.color ? ink.faint : categoryColor(g.color))

/** A row a month (or week): its spending as one solid bar, each group's
 * share in its colour (largest group first, Other last), against the
 * range's biggest month, then the total. A month still running or cut by
 * the range is dimmed. Newest kept when they don't all fit. */
export function TrendsView(props: { groups: TrendGroup[]; rows: TrendRow[]; width: number; height: number; progress?: number }) {
  const p = () => props.progress ?? 1
  const barWidth = () => Math.max(4, props.width - TREND_LABEL - TREND_TOTAL - 1)
  const room = () => Math.max(1, props.height)
  const shown = createMemo(() => (props.rows.length > room() ? props.rows.slice(props.rows.length - (room() - 1)) : props.rows))
  const earlier = () => props.rows.length - shown().length
  const most = createMemo(() => Math.max(1, ...props.rows.map((r) => r.total)))
  // Drawing in: the bars grow from the left.
  const grown = () => Math.min(1, p() / 0.8)
  const line = (r: TrendRow): StyledSpan[] => {
    // Each group's cells from the running total, so rounding never
    // shortens the whole bar.
    const width = Math.round((r.total / most()) * barWidth() * grown())
    let before = 0
    const cells = r.amounts.map((a) => {
      const from = Math.round((before / Math.max(1, r.total)) * width)
      before += a
      return Math.round((before / Math.max(1, r.total)) * width) - from
    })
    return [
      { text: fit(r.label, TREND_LABEL), fg: r.partial ? ink.note : ink.figure },
      ...cells.flatMap((n, i): StyledSpan[] => (n > 0 ? [{ text: "█".repeat(n), fg: groupColour(props.groups[i]!) }] : [])),
      { text: " ".repeat(Math.max(0, barWidth() - width)), fg: ink.note },
      { text: formatWholeMoney(r.total).padStart(TREND_TOTAL), fg: r.partial ? ink.note : ink.label },
    ]
  }
  // With room, each bar is up to BAR_LINES lines thick with a gap under it;
  // the month and its total on its first line.
  const per = () => Math.floor(room() / Math.max(1, shown().length))
  const thick = () => (per() >= 3 ? Math.min(BAR_LINES, per() - 1) : 1)
  const gap = () => (per() >= 3 ? 1 : 0)
  const lines = createMemo((): StyledSpan[][] => shown().slice(earlier() > 0 ? 1 : 0).flatMap((r) => {
    const first = line(r)
    // The bar's other lines: the same cells, no label or total.
    const rest = [{ text: " ".repeat(TREND_LABEL), fg: ink.note }, ...first.slice(1, -1)]
    return [first, ...Array.from({ length: thick() - 1 }, () => rest), ...Array.from({ length: gap() }, () => [{ text: " ", fg: ink.note }])]
  }))
  return (
    <Show when={props.rows.some((r) => r.total > 0)} fallback={<text fg={ink.note}>No spending in this range</text>}>
      <Show when={earlier() > 0}><text fg={ink.note}>{`… ${earlier()} earlier`}</text></Show>
      <Index each={lines()}>{(spans) => <StyledLine spans={spans()} />}</Index>
    </Show>
  )
}

/** Trends' legend: each group's colour and name. */
export function trendsLegend(groups: TrendGroup[]): Span[] {
  return groups.flatMap((g, i): Span[] => [
    { text: `${i ? "  " : ""}■ `, fg: groupColour(g) },
    { text: g.name, fg: ink.label },
  ])
}

const MERCHANT_COLUMNS = { count: 6, spent: 10, change: 10 }

/** Where the range's spending went: each merchant's category mark, name,
 * how many times, how much, a solid bar of its share where there's room,
 * and the change from the period before ("new" when it wasn't there). */
export function MerchantsView(props: { rows: MerchantRow[]; width: number; height: number; progress?: number }) {
  const p = () => props.progress ?? 1
  const withChange = () => props.rows.some((r) => r.before != null)
  const fixed = () => 2 + MERCHANT_COLUMNS.count + MERCHANT_COLUMNS.spent + (withChange() ? MERCHANT_COLUMNS.change : 0)
  // The name gets up to 28; then a bar, if 6 or more are left.
  const nameWidth = () => Math.max(8, Math.min(28, props.width - fixed()))
  const barWidth = () => (props.width - fixed() - nameWidth() - 2 >= 6 ? Math.min(24, props.width - fixed() - nameWidth() - 2) : 0)
  const room = () => Math.max(1, props.height - 1)
  const shown = createMemo(() => (props.rows.length > room() ? props.rows.slice(0, room() - 1) : props.rows))
  const more = () => props.rows.length - shown().length
  const most = createMemo(() => Math.max(1, ...props.rows.map((r) => r.spent)))
  const rowsIn = () => Math.ceil(Math.min(1, p() / 0.6) * shown().length)
  const colour = (id: number | null) => categoryColor(data.state.categories.find((c) => c.id === id)?.color)
  const change = (r: MerchantRow): StyledSpan => {
    if (r.before == null) return { text: "".padStart(MERCHANT_COLUMNS.change), fg: ink.note }
    if (r.before === 0) return { text: "new".padStart(MERCHANT_COLUMNS.change), fg: ink.note }
    const delta = r.spent - r.before
    return { text: signedWholeMoney(delta).padStart(MERCHANT_COLUMNS.change), fg: spendChangeColor(delta) }
  }
  const line = (r: MerchantRow): StyledSpan[] => [
    { text: `${categoryMark(r.categoryId)} `, fg: colour(r.categoryId) },
    { text: fit(r.merchant, nameWidth()), fg: ink.figure },
    { text: `×${r.count}`.padStart(MERCHANT_COLUMNS.count), fg: ink.note },
    { text: formatWholeMoney(r.spent).padStart(MERCHANT_COLUMNS.spent), fg: ink.figure },
    ...(withChange() ? [change(r)] : []),
    ...(barWidth() ? [{ text: "  " + "█".repeat(Math.max(1, Math.round((r.spent / most()) * barWidth()))), fg: colour(r.categoryId) }] : []),
  ]
  return (
    <Show when={props.rows.length} fallback={<text fg={ink.note}>No spending in this range</text>}>
      <StyledLine spans={[
        heading("  Merchant", nameWidth() + 2, true), heading("Times", MERCHANT_COLUMNS.count), heading("Spent", MERCHANT_COLUMNS.spent),
        ...(withChange() ? [heading("vs Before", MERCHANT_COLUMNS.change)] : []),
      ]} />
      <Index each={shown()}>{(r, i) => <StyledLine spans={i < rowsIn() ? line(r()) : [{ text: " " }]} />}</Index>
      <Show when={more() > 0}><text fg={ink.note}>{`… ${more()} more`}</text></Show>
    </Show>
  )
}

/** Merchants' legend: how many, and how much of the spending the top five are. */
export function merchantsLegend(rows: MerchantRow[]): Span[] {
  if (!rows.length) return []
  const total = rows.reduce((n, r) => n + r.spent, 0)
  const top = rows.slice(0, 5).reduce((n, r) => n + r.spent, 0)
  return [
    { text: count(rows.length, "merchant"), fg: ink.label },
    ...(rows.length > 5 && total > 0 ? [{ text: ` · the top 5 are ${Math.round((top / total) * 100)}% of spending`, fg: ink.label }] : []),
  ]
}
