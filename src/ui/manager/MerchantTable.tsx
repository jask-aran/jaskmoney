import { For, Show, createMemo } from "solid-js"
import { S } from "../primitives/S"
import { categoryColor, theme } from "../../theme"
import { formatMoney } from "../../domain/dashboard"
import { rowAppearance } from "../../domain/rowStyle"
import type { MerchantGroup, MerchantSort } from "../../domain/merchants"
import { fit, shortDate } from "../text"
import { appToday } from "../../domain/days"
import { categoryMark } from "../icons"

const COLUMNS = { marker: 1, gap: 1, total: 12, count: 5, average: 12, last: 9, category: 22 } as const

/**
 * The Transactions table grouped by merchant: one row per merchant with its
 * signed total, row count, average, latest date and usual category, styled
 * like the row table (cursor only; selection and range belong to rows).
 */
export function MerchantTable(props: {
  groups: MerchantGroup[]
  top: number
  visible: number
  cursor: number | null
  width: number
  sort: MerchantSort
  reverse: boolean
  empty: string
}) {
  const nameWidth = () => Math.max(10, props.width - COLUMNS.marker - COLUMNS.total - COLUMNS.count - COLUMNS.average - COLUMNS.last - COLUMNS.category - 5 * COLUMNS.gap)
  const mark = (column: MerchantSort) => (props.sort === column ? (props.reverse ? " ▲" : " ▼") : "")
  const windowRows = createMemo(() => props.groups.slice(props.top, props.top + props.visible))
  const gap = " ".repeat(COLUMNS.gap)
  return (
    <>
      <text fg={theme.subtext0}>
        <b>
          {" ".repeat(COLUMNS.marker)}
          {fit(`Merchant${mark("merchant")}`, nameWidth())}
          {gap}
          {`Total${mark("total")}`.padStart(COLUMNS.total)}
          {gap}
          {`#${mark("count")}`.padStart(COLUMNS.count)}
          {gap}
          {"Average".padStart(COLUMNS.average)}
          {gap}
          {`Last${mark("last")}`.padStart(COLUMNS.last)}
          {gap}
          {"Category".padEnd(COLUMNS.category)}
        </b>
      </text>
      <Show when={props.groups.length} fallback={<text fg={theme.overlay1}>{props.empty}</text>}>
        <box flexGrow={1} flexDirection="column">
          <For each={windowRows()}>
            {(g, i) => {
              const isCursor = () => props.cursor === props.top + i()
              const look = () => rowAppearance(false, false, isCursor())
              const bg = () => look().bg ?? theme.canvas
              const fg = (color: string) => look().fg ?? color
              const amountColor = (n: number) => (n < 0 ? theme.error : theme.success)
              const muted = () => !g.categoryName || g.categoryName === "Uncategorised"
              const catColor = () => categoryColor(muted() ? null : g.categoryColor)
              return (
                <text width="100%" bg={bg()}>
                  <S fg={fg(theme.accent)} bg={bg()} bold={look().bold}>{isCursor() ? ">" : " "}</S>
                  <S fg={fg(theme.brightText)} bg={bg()} bold={look().bold}>{fit(g.merchant, nameWidth())}</S>
                  <S bg={bg()}>{gap}</S>
                  <S fg={fg(amountColor(g.total))} bg={bg()} bold={look().bold}>{formatMoney(g.total).padStart(COLUMNS.total)}</S>
                  <S bg={bg()}>{gap}</S>
                  <S fg={fg(theme.subtext0)} bg={bg()}>{String(g.count).padStart(COLUMNS.count)}</S>
                  <S bg={bg()}>{gap}</S>
                  <S fg={fg(theme.subtext0)} bg={bg()}>{formatMoney(g.average).padStart(COLUMNS.average)}</S>
                  <S bg={bg()}>{gap}</S>
                  <S fg={fg(theme.mutedText)} bg={bg()}>{lastSeen(g.lastISO).padStart(COLUMNS.last)}</S>
                  <S bg={bg()}>{gap}</S>
                  <S fg={fg(catColor())} bg={bg()} dim={muted() && !look().fg}>{fit(`${categoryMark(g.categoryId, muted())} ${g.categoryName || "Uncategorised"}`, COLUMNS.category)}</S>
                </text>
              )
            }}
          </For>
        </box>
      </Show>
    </>
  )
}

/** "21 Oct" this year, "28 Jun 25" before it. */
function lastSeen(iso: string): string {
  return iso.slice(0, 4) === appToday().slice(0, 4) ? shortDate(iso) : `${shortDate(iso)} ${iso.slice(2, 4)}`
}
