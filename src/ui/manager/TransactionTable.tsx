import { For, Show, createMemo } from "solid-js"
import { S } from "../primitives/S"
import { categoryColor, isUncategorisedColor, theme } from "../../theme"
import { data } from "../../state/dataStore"
import { formatMoney } from "../../domain/dashboard"
import { rowAppearance } from "../../domain/rowStyle"
import type { Transaction } from "../../domain/types"
import { fit } from "../text"
import { categoryMark } from "../icons"

/**
 * The transaction table shared by the Manager and the Dashboard's Recent
 * list: header, then the rows in view. Cursor, selection and range are
 * independent states styled by rowAppearance. Pending (held) rows are
 * italic with a grey clock after the amount.
 */
const columns = {
  marker: 1,
  gap: 1,
  date: 9,
  /** The amount, then a pending marker. */
  amount: 13,
  account: 12,
  category: 16,
} as const

const DESCRIPTION_TARGET = 40

/** Go renderTransactionTable: description takes up to its target width, tags
 * take the remainder so row state backgrounds span the whole table. As in Go
 * (hasMultipleAccountNames), the Account column only shows for several accounts. */
export function tableLayout(contentWidth: number, showAccount: boolean, showTags = true): { description: number; category: number; tags: number; showAccount: boolean; showTags: boolean } {
  const fixed = columns.marker + columns.date + columns.amount + columns.category + 3 * columns.gap +
    (showTags ? columns.gap : 0) + (showAccount ? columns.account + columns.gap : 0)
  const avail = contentWidth - fixed
  let description = Math.min(DESCRIPTION_TARGET, avail)
  if (description < 5) description = Math.max(5, avail)
  // Tags, or without them the category, take the rest, so row backgrounds
  // span the table.
  const rest = Math.max(0, contentWidth - fixed - description)
  return showTags
    ? { description, category: columns.category, tags: Math.max(1, rest), showAccount, showTags }
    : { description, category: columns.category + rest, tags: 0, showAccount, showTags }
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y.slice(2)}`
}


function formatCategory(
  categoryId: number | null,
  name: string,
  color: string | undefined,
  width: number,
): { marker: string; markerColor: string; text: string; textColor: string; muted: boolean } {
  const muted = !name || name === "Uncategorised" || isUncategorisedColor(color)
  const text = name || "Uncategorised"
  return {
    marker: `${categoryMark(categoryId, muted)} `,
    markerColor: categoryColor(color),
    text: fit(text, width - 2),
    textColor: categoryColor(color),
    muted,
  }
}

function formatTags(
  names: string[],
  colors: string[],
  width: number,
): { text: string; color: string } {
  if (!names.length) return { text: "-".padEnd(width), color: theme.overlay1 }
  const head = names[0]!
  const extra = names.length > 1 ? `+${names.length - 1}` : ""
  const raw = extra ? `${head},${extra}` : head
  return {
    text: fit(raw, width),
    color: colors[0] || theme.teal,
  }
}

/** The marker after a pending amount: a clock icon, or ◷ without icons. */
function pendingMark(): string {
  return data.state.icons ? "\uf017" : "◷"
}

export function TransactionTable(props: {
  rows: Transaction[]
  /** Index of the first row in view, and how many fit. */
  top: number
  visible: number
  /** Absolute cursor index; null when the table is not focused. */
  cursor: number | null
  /** Content width (inside the card's border and padding). */
  width: number
  showAccount: boolean
  showTags: boolean
  selectedIds?: Record<number, boolean>
  highlighted?: Record<number, boolean>
  sortMark?: (column: string) => string
  empty: string
}) {
  const layout = createMemo(() => tableLayout(props.width, props.showAccount, props.showTags))
  const mark = (column: string) => props.sortMark?.(column) ?? ""
  const windowRows = createMemo(() => props.rows.slice(props.top, props.top + props.visible))
  return (
    <>
      <text fg={theme.subtext0}>
        <b>
          {" ".repeat(columns.marker)}
          {`Date${mark("date")}`.padEnd(columns.date)}
          {" ".repeat(columns.gap)}
          {`Amount${mark("amount")}`.padEnd(columns.amount)}
          {" ".repeat(columns.gap)}
          {fit(`Description${mark("description")}`, layout().description)}
          {layout().showAccount ? " ".repeat(columns.gap) + `Account${mark("account")}`.padEnd(columns.account) : ""}
          {" ".repeat(columns.gap)}
          {`Category${mark("category")}`.padEnd(layout().category)}
          {layout().showTags ? " ".repeat(columns.gap) + fit("Tags", layout().tags) : ""}
        </b>
      </text>
      <Show when={props.rows.length} fallback={<text fg={theme.overlay1}>{props.empty}</text>}>
        <box flexGrow={1} flexDirection="column">
          <For each={windowRows()}>
            {(r, i) => {
              const absIndex = () => props.top + i()
              const isCursor = () => props.cursor === absIndex()
              const selected = () => !!props.selectedIds?.[r.id]
              const hl = () => !!props.highlighted?.[r.id]
              // OpenTUI cannot repaint a previous cell to transparency: it must
              // receive the table canvas colour when a row loses its state bg.
              // This is visually identical to the unstyled table background.
              const look = () => rowAppearance(selected(), hl(), isCursor())
              const rowBg = () => look().bg ?? theme.canvas
              const fg = (column: string) => look().fg ?? column
              // Up holds (pending) render italic, with a clock, until they settle.
              const held = () => r.status === "HELD"
              const tags = () => formatTags(r.tagNames, r.tagColors, layout().tags)
              const category = () => formatCategory(r.categoryId, r.categoryName, r.categoryColor, layout().category)
              const strong = () => look().bold
              return (
                <text width="100%" bg={rowBg()}>
                  <S fg={fg(theme.accent)} bg={rowBg()} bold={strong()}>
                    {isCursor() ? ">" : selected() ? "*" : " "}
                  </S>
                  <S fg={fg(theme.mutedText)} bg={rowBg()} bold={strong()}>
                    {fmtDate(r.dateISO).padEnd(columns.date)}
                  </S>
                  <S fg={fg(theme.text)} bg={rowBg()} bold={strong()}>
                    {" ".repeat(columns.gap)}
                  </S>
                  <S fg={fg(r.amount < 0 ? theme.error : theme.success)} bg={rowBg()} bold={strong()} italic={held()}>
                    {formatMoney(r.amount).padEnd(columns.amount - 2)}
                  </S>
                  <S fg={fg(theme.overlay1)} bg={rowBg()}>
                    {held() ? `${pendingMark()} ` : "  "}
                  </S>
                  <S fg={fg(theme.text)} bg={rowBg()} bold={strong()}>
                    {" ".repeat(columns.gap)}
                  </S>
                  <S fg={fg(theme.brightText)} bg={rowBg()} bold={strong()} italic={held()}>
                    {fit(r.description, layout().description)}
                  </S>
                  <S fg={fg(theme.dimText)} bg={rowBg()} bold={strong()}>
                    {layout().showAccount ? " ".repeat(columns.gap) + fit(r.accountName, columns.account) : ""}
                  </S>
                  <S fg={fg(theme.text)} bg={rowBg()} bold={strong()}>
                    {" ".repeat(columns.gap)}
                  </S>
                  <S fg={fg(category().markerColor)} bg={rowBg()} bold={strong() && (!category().muted || !!look().fg)}>
                    {category().marker}
                  </S>
                  <S
                    fg={fg(category().textColor)}
                    bg={rowBg()}
                    bold={strong() && (!category().muted || !!look().fg)}
                    dim={category().muted && !look().fg}
                  >
                    {category().text}
                  </S>
                  <Show when={layout().showTags}>
                    <S fg={fg(theme.text)} bg={rowBg()} bold={strong()}>
                      {" ".repeat(columns.gap)}
                    </S>
                    <S fg={fg(tags().color)} bg={rowBg()} bold={strong()}>
                      {tags().text}
                    </S>
                  </Show>
                </text>
              )
            }}
          </For>
        </box>
      </Show>
    </>
  )
}
