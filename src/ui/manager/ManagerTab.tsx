import { For, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme, uncategorisedColor } from "../../theme"
import { formatMoney } from "../../domain/dashboard"
import { rowAppearance } from "../../domain/rowStyle"
import { filterExprString } from "../../domain/filter"
import type { Account } from "../../domain/types"
import { fit, truncate } from "../text"
import { selectableEntries, selectedAccounts, selectionLabel, sidebarEntries } from "../../domain/accountTree"
import { computeAccountStats } from "../../domain/accountStats"
import { toISODate } from "../../domain/timeframe"
import { AccountDetails } from "./AccountDetails"
import { categoryMark } from "../icons"
import { TransactionDetail } from "./TransactionDetail"

const columns = {
  marker: 1,
  gap: 1,
  date: 9,
  amount: 12,
  account: 12,
  category: 16,
} as const

const DESCRIPTION_TARGET = 40
/** Sidebar width, borders included. */
export const SIDEBAR_WIDTH = 36
/** Below this width the sidebar folds into a one-line account header. */
const WIDE = 110

/** Go renderTransactionTable: description takes up to its target width, tags
 * take the remainder so row state backgrounds span the whole table. As in Go
 * (hasMultipleAccountNames), the Account column only shows for several accounts. */
export function tableLayout(contentWidth: number, showAccount: boolean): { description: number; tags: number; showAccount: boolean } {
  const fixed = columns.marker + columns.date + columns.amount + columns.category + 4 * columns.gap +
    (showAccount ? columns.account + columns.gap : 0)
  const avail = contentWidth - fixed
  let description = Math.min(DESCRIPTION_TARGET, avail)
  if (description < 5) description = Math.max(5, avail)
  return { description, tags: Math.max(1, contentWidth - fixed - description), showAccount }
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y.slice(2)}`
}


function catFg(color: string | undefined): string {
  if (!color || color === "" || color === "#7f849c") return uncategorisedColor
  return color
}

function formatCategory(
  categoryId: number | null,
  name: string,
  color: string | undefined,
  width: number,
): { marker: string; markerColor: string; text: string; textColor: string; muted: boolean } {
  const muted = !name || name === "Uncategorised" || !color || color === "#7f849c"
  const text = name || "Uncategorised"
  return {
    marker: `${categoryMark(categoryId, muted)} `,
    markerColor: catFg(color),
    text: fit(text, width - 2),
    textColor: catFg(color),
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

export function ManagerTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  const rows = createMemo(() => data.scopedTransactions())
  const highlighted = createMemo(() => ui.highlightedIds(rows()))
  const entries = createMemo(() => sidebarEntries(data.state.accounts))
  const showAccount = () => selectedAccounts(data.state.accounts, data.state.accountSelection).length > 1
  const wide = () => dims().width >= WIDE
  const stats = createMemo(() => computeAccountStats(selectedAccounts(data.state.accounts, data.state.accountSelection), data.state.transactions, toISODate(new Date())))
  // Wide: the table sits right of the sidebar and a 1-cell gap. Narrow: it
  // spans the tab under the account header (3 rows). Its card spends 4 cells
  // on border + padding.
  const layout = createMemo(() => tableLayout(dims().width - (wide() ? SIDEBAR_WIDTH + 1 : 0) - 4, showAccount()))

  createEffect(() => {
    // App chrome (4), transaction borders (2), and the table header (1) are
    // fixed. The viewport consumes every remaining row.
    const vis = Math.max(1, dims().height - 7 - (filterBar() ? 1 : 0) - (wide() ? 0 : 3))
    if (vis !== ui.state.managerVisible) {
      ui.setState({ managerVisible: vis })
    }
  })

  createEffect(() => {
    const n = rows().length
    if (n === 0 && ui.state.managerCursor !== 0) {
      ui.setState({ managerCursor: 0, managerTop: 0 })
    } else if (n > 0 && ui.state.managerCursor >= n) {
      ui.jumpManagerCursor(n - 1, n)
    }
  })

  createEffect(() => {
    const maxTop = Math.max(0, rows().length - ui.state.managerVisible)
    if (ui.state.managerTop > maxTop) ui.setState({ managerTop: maxTop })
  })

  const windowRows = createMemo(() => {
    const all = rows()
    return all.slice(ui.state.managerTop, ui.state.managerTop + ui.state.managerVisible)
  })

  const txFocused = () =>
    props.focused === "mgr.transactions" || props.focused === "none"
  const acctFocused = () => props.focused === "mgr.accounts"
  const selCount = () => Object.keys(ui.state.selectedIds).length

  const sortMark = (col: string) => {
    if (data.state.sortColumn !== col) return ""
    return data.state.sortAscending ? " ▲" : " ▼"
  }

  const scrollIndicator = () => {
    if (rows().length === 0) return undefined
    const start = ui.state.managerTop + 1
    const end = Math.min(ui.state.managerTop + ui.state.managerVisible, rows().length)
    return `─ showing ${start}-${end} of ${rows().length}${
      selCount() > 0 ? ` · ${selCount()} selected` : ""
    }${ui.state.rangeSelecting ? " · range" : ""} · sort ${data.state.sortColumn}${
      data.state.sortAscending ? "↑" : "↓"
    } ─`
  }

  // Go-style filter bar: the input stays in the pane; its canonical form is
  // rendered next to the title.
  const filterBar = () => {
    const editing = ui.state.filterMode
    const raw = editing ? ui.state.filterDraft : data.state.filterQuery
    if (!editing && !raw.trim()) return null
    const err = data.state.filterErr
    const dotColor = err ? theme.error : theme.success
    const dotLabel = err ? "parse" : "ok"
    const preview =
      data.filterPreview() ||
      (data.state.filterExpr ? filterExprString(data.state.filterExpr) : raw)
    return { editing, raw, err, dotColor, dotLabel, preview }
  }

  const filterTitle = () => {
    const fb = filterBar()
    if (!fb?.preview) return undefined
    return `[${truncate(fb.preview, 48)}]`
  }

  const accountAction = () => data.state.accounts.find((account) => account.id === ui.state.accountActionId)

  return (
    <box width="100%" height="100%" flexDirection={wide() ? "row" : "column"} gap={wide() ? 1 : 0} backgroundColor={theme.canvas}>
      <Show when={!wide()}>
        <SectionCard
          title={`Account · ${selectionLabel(data.state.accounts, data.state.accountSelection)}`}
          titleSuffix={acctFocused() ? "· j/k to switch" : "· a to switch"}
          titleSuffixColor={theme.overlay1}
          focused={acctFocused()}
          height={3}
        >
          <text wrapMode="none">
            <S fg={theme.subtext0}>{"Balance "}</S>
            <S fg={theme.text}>{stats().balance != null ? formatMoney(stats().balance!) : "—"}</S>
            <Show when={stats().held.count > 0}>
              <S fg={theme.overlay1}>{` · ${formatMoney(Math.abs(stats().held.amount))} pending, ${stats().held.count} txn`}</S>
            </Show>
            <S fg={theme.subtext0}>{" · 30 days in "}</S>
            <S fg={theme.success}>{formatMoney(stats().windows[0]?.moneyIn ?? 0)}</S>
            <S fg={theme.subtext0}>{" out "}</S>
            <S fg={theme.error}>{formatMoney(stats().windows[0]?.moneyOut ?? 0)}</S>
          </text>
        </SectionCard>
      </Show>
      <Show when={wide()}>
      <box width={SIDEBAR_WIDTH} flexShrink={0} height="100%" flexDirection="column">
        <SectionCard title="Accounts" focused={acctFocused()} active={acctFocused()} height={entries().length + 2}>
          <Show when={data.state.accounts.length} fallback={<text fg={theme.overlay1}>No accounts yet</text>}>
            <For each={entries()}>
              {(entry) => {
                if (entry.kind === "heading") return <text fg={theme.overlay1} wrapMode="none">{entry.label}</text>
                const index = () => selectableEntries(data.state.accounts).findIndex((e) => e.selection === entry.selection)
                const current = () => data.state.accountSelection === entry.selection
                const cursor = () => acctFocused() && ui.state.accountCursor === index()
                const bg = () => (cursor() ? theme.surface0 : theme.canvas)
                const labelWidth = SIDEBAR_WIDTH - 4 - 2 - 2 * entry.depth - 12
                return (
                  <text bg={bg()} wrapMode="none">
                    <S fg={theme.accent} bg={bg()} bold>{current() ? "▸ " : "  "}</S>
                    <S bg={bg()}>{"  ".repeat(entry.depth)}</S>
                    <S fg={current() ? theme.text : theme.subtext0} bg={bg()} bold={current()}>{fit(entry.label, labelWidth)}</S>
                    <S fg={entry.balance != null && entry.balance < 0 ? theme.error : theme.subtext1} bg={bg()}>
                      {(entry.balance != null ? formatMoney(entry.balance) : "").padStart(12)}
                    </S>
                  </text>
                )
              }}
            </For>
          </Show>
        </SectionCard>
        <AccountDetails />
      </box>
      </Show>

      <SectionCard
        title="Transactions"
        titleSuffix={filterTitle()}
        titleSuffixColor={data.state.filterErr ? theme.error : theme.blue}
        focused={txFocused()}
        active={txFocused()}
        flexGrow={1}
        height={wide() ? "100%" : undefined}
        bottomTitle={scrollIndicator()}
      >
        <Show when={filterBar()}>
          {(fb: () => NonNullable<ReturnType<typeof filterBar>>) => (
            <text>
              <S fg={theme.accent} bold>
                /
              </S>
              <S fg={theme.text}> {fb().raw}</S>
              {fb().editing ? <S fg={theme.accent}>▌</S> : null}
              <S fg={theme.text}>{"  "}</S>
              <S fg={fb().dotColor}>●</S>
              <S fg={fb().dotColor}> {fb().dotLabel}</S>
              {!fb().editing ? <S fg={theme.overlay1}>{"  (esc clear)"}</S> : null}
            </text>
          )}
        </Show>
        <text fg={theme.subtext0}>
          <b>
            {" ".repeat(columns.marker)}
            {`Date${sortMark("date")}`.padEnd(columns.date)}
            {" ".repeat(columns.gap)}
            {`Amount${sortMark("amount")}`.padEnd(columns.amount)}
            {" ".repeat(columns.gap)}
            {fit(`Description${sortMark("description")}`, layout().description)}
            {layout().showAccount ? " ".repeat(columns.gap) + `Account${sortMark("account")}`.padEnd(columns.account) : ""}
            {" ".repeat(columns.gap)}
            {`Category${sortMark("category")}`.padEnd(columns.category)}
            {" ".repeat(columns.gap)}
            {fit("Tags", layout().tags)}
          </b>
        </text>
        {rows().length === 0 ? (
          <text fg={theme.overlay1}>
            {data.state.filterQuery ? "No matches" : "Empty · no transactions loaded"}
          </text>
        ) : (
          <box flexGrow={1} flexDirection="column">
            <For each={windowRows()}>
              {(r, i) => {
                const absIndex = () => ui.state.managerTop + i()
                const isCursor = () =>
                  txFocused() &&
                  !ui.state.filterMode &&
                  absIndex() === ui.state.managerCursor
                const selected = () => !!ui.state.selectedIds[r.id]
                const hl = () => !!highlighted()[r.id]
                // OpenTUI cannot repaint a previous cell to transparency: it must
                // receive the table canvas colour when a row loses its state bg.
                // This is visually identical to the unstyled table background.
                const look = () => rowAppearance(selected(), hl(), isCursor())
                const rowBg = () => look().bg ?? theme.canvas
                const fg = (column: string) => look().fg ?? column
                // Up holds (pending) render italic until they settle.
                const held = () => r.status === "HELD"
                const tags = () => formatTags(r.tagNames, r.tagColors, layout().tags)
                const category = () =>
                  formatCategory(r.categoryId, r.categoryName, r.categoryColor, columns.category)
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
                    <S
                      fg={fg(r.amount < 0 ? theme.error : theme.success)}
                      bg={rowBg()}
                      bold={strong()}
                      italic={held()}
                    >
                      {formatMoney(r.amount).padEnd(columns.amount)}
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
                    <S
                      fg={fg(category().markerColor)}
                      bg={rowBg()}
                      bold={strong() && (!category().muted || !!look().fg)}
                    >
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
                    <S fg={fg(theme.text)} bg={rowBg()} bold={strong()}>
                      {" ".repeat(columns.gap)}
                    </S>
                    <S fg={fg(tags().color)} bg={rowBg()} bold={strong()}>
                      {tags().text}
                    </S>
                  </text>
                )
              }}
            </For>
          </box>
        )}
      </SectionCard>
      <TransactionDetail />
      <Show when={accountAction()}>{(account: () => Account) => <box position="absolute" zIndex={20} left="22%" top="35%" width="56%" border borderStyle="rounded" borderColor={theme.warning} paddingLeft={1} paddingRight={1} backgroundColor={theme.base} flexDirection="column">
        <text fg={theme.warning}><b>Account data · {account().name}</b></text>
        <text fg={theme.text}>c clear this account’s transactions</text>
        <text fg={theme.error}>x remove this account and its transactions</text>
        <text fg={theme.overlay1}>Press del to confirm either action · esc cancel</text>
      </box>}</Show>
    </box>
  )
}
