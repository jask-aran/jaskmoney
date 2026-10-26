import { For, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme, uncategorisedColor } from "../../theme"
import { formatMoney } from "../../domain/dashboard"
import { rowBackground } from "../../domain/rowStyle"
import { filterExprString } from "../../domain/filter"
import type { Account } from "../../domain/types"

const columns = {
  marker: 1,
  gap: 1,
  date: 9,
  amount: 12,
  account: 12,
  category: 16,
} as const

const DESCRIPTION_TARGET = 40
const FIXED_WITHOUT_TAGS =
  columns.marker + columns.date + columns.amount + columns.account + columns.category + 5 * columns.gap

/** Go renderTransactionTable: description takes up to its target width, tags
 * take the remainder so row state backgrounds span the whole table. */
export function tableLayout(contentWidth: number): { description: number; tags: number } {
  const avail = contentWidth - FIXED_WITHOUT_TAGS
  let description = Math.min(DESCRIPTION_TARGET, avail)
  if (description < 5) description = Math.max(5, avail)
  return { description, tags: Math.max(1, contentWidth - FIXED_WITHOUT_TAGS - description) }
}

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y.slice(2)}`
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, Math.max(0, n - 1)) + "…"
}

function catFg(color: string | undefined): string {
  if (!color || color === "" || color === "#7f849c") return uncategorisedColor
  return color
}

function formatCategory(
  name: string,
  color: string | undefined,
  width: number,
): { marker: string; markerColor: string; text: string; textColor: string; muted: boolean } {
  const muted = !name || name === "Uncategorised" || !color || color === "#7f849c"
  const text = name || "Uncategorised"
  return {
    marker: muted ? "○ " : "● ",
    markerColor: catFg(color),
    text: truncate(text, width - 2).padEnd(width - 2),
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
    text: truncate(raw, width).padEnd(width),
    color: colors[0] || theme.teal,
  }
}

export function ManagerTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  const rows = createMemo(() => data.scopedTransactions())
  const accounts = () => data.state.accounts
  const highlighted = createMemo(() => ui.highlightedIds(rows()))
  // Card borders (2) and horizontal padding (2) surround the table.
  const layout = createMemo(() => tableLayout(dims().width - 4))

  createEffect(() => {
    // App chrome (4), Accounts (3), transaction borders (2), and the table
    // header (1) are fixed. The viewport consumes every remaining row.
    const vis = Math.max(1, dims().height - 10 - (filterBar() ? 1 : 0))
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
    <box width="100%" height="100%" flexDirection="column" gap={0} backgroundColor={theme.canvas}>
      <SectionCard title="Accounts" focused={acctFocused()} active={acctFocused()} height={3}>
        {accounts().length === 0 ? (
          <text fg={theme.overlay1}>No accounts · waiting for ingest</text>
        ) : (
          <box flexDirection="row" gap={3}>
            <For each={accounts()}>
              {(a, i) => {
                const on = () => data.state.accountScope[a.id] !== false
                const count = () =>
                  data.state.transactions.filter((t) => t.accountId === a.id).length
                const selected = () => acctFocused() && ui.state.accountCursor === i()
                const typeColor = () =>
                  a.type === "credit" ? theme.peach : theme.subtext1
                const countColor = () =>
                  count() === 0 ? theme.overlay1 : theme.subtext1
                const scopeColor = () => (on() ? theme.success : theme.overlay1)
                const scopeText = () => (on() ? "On" : "Off")
                const countText = () => (count() === 0 ? "Empty" : String(count()))
                return (
                  <text>
                    <S fg={theme.accent} bold>
                      {selected() ? "▸ " : "  "}
                    </S>
                    <S fg={theme.text}>{a.name}</S>
                    <S fg={theme.text}> </S>
                    <S fg={typeColor()}>{a.type.toUpperCase()}</S>
                    <S fg={theme.text}> </S>
                    <S fg={countColor()}>{countText()}</S>
                    <S fg={theme.text}> </S>
                    <S fg={scopeColor()}>{scopeText()}</S>
                  </text>
                )
              }}
            </For>
          </box>
        )}
      </SectionCard>

      <SectionCard
        title="Transactions"
        titleSuffix={filterTitle()}
        titleSuffixColor={data.state.filterErr ? theme.error : theme.blue}
        focused={txFocused()}
        active={txFocused()}
        flexGrow={1}
        height="100%"
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
              {!fb().editing ? <S fg={theme.overlay1}>  (esc clear)</S> : null}
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
            {truncate(`Description${sortMark("description")}`, layout().description).padEnd(layout().description)}
            {" ".repeat(columns.gap)}
            {`Account${sortMark("account")}`.padEnd(columns.account)}
            {" ".repeat(columns.gap)}
            {`Category${sortMark("category")}`.padEnd(columns.category)}
            {" ".repeat(columns.gap)}
            {truncate("Tags", layout().tags).padEnd(layout().tags)}
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
                const rowBg = () =>
                  rowBackground(selected(), hl(), isCursor()) ?? theme.canvas
                const tags = () => formatTags(r.tagNames, r.tagColors, layout().tags)
                const category = () =>
                  formatCategory(r.categoryName, r.categoryColor, columns.category)
                const strong = () => isCursor()
                return (
                  <text width="100%" bg={rowBg()}>
                    <S fg={theme.accent} bg={rowBg()} bold={strong()}>
                      {isCursor() ? ">" : selected() ? "*" : " "}
                    </S>
                    <S fg={theme.mutedText} bg={rowBg()} bold={strong()}>
                      {fmtDate(r.dateISO).padEnd(columns.date)}
                    </S>
                    <S fg={theme.text} bg={rowBg()} bold={strong()}>
                      {" ".repeat(columns.gap)}
                    </S>
                    <S
                      fg={r.amount < 0 ? theme.error : theme.success}
                      bg={rowBg()}
                      bold={strong()}
                    >
                      {formatMoney(r.amount).padEnd(columns.amount)}
                    </S>
                    <S fg={theme.text} bg={rowBg()} bold={strong()}>
                      {" ".repeat(columns.gap)}
                    </S>
                    <S fg={theme.brightText} bg={rowBg()} bold={strong()}>
                      {truncate(r.description, layout().description).padEnd(layout().description)}
                    </S>
                    <S fg={theme.text} bg={rowBg()} bold={strong()}>
                      {" ".repeat(columns.gap)}
                    </S>
                    <S fg={theme.dimText} bg={rowBg()} bold={strong()}>
                      {truncate(r.accountName, columns.account).padEnd(columns.account)}
                    </S>
                    <S fg={theme.text} bg={rowBg()} bold={strong()}>
                      {" ".repeat(columns.gap)}
                    </S>
                    <S
                      fg={category().markerColor}
                      bg={rowBg()}
                      bold={strong() && !category().muted}
                    >
                      {category().marker}
                    </S>
                    <S
                      fg={category().textColor}
                      bg={rowBg()}
                      bold={strong() && !category().muted}
                      dim={category().muted}
                    >
                      {category().text}
                    </S>
                    <S fg={theme.text} bg={rowBg()} bold={strong()}>
                      {" ".repeat(columns.gap)}
                    </S>
                    <S fg={tags().color} bg={rowBg()} bold={strong()}>
                      {tags().text}
                    </S>
                  </text>
                )
              }}
            </For>
          </box>
        )}
      </SectionCard>
      <Show when={accountAction()}>{(account: () => Account) => <box position="absolute" zIndex={20} left="22%" top="35%" width="56%" border borderStyle="rounded" borderColor={theme.warning} paddingLeft={1} paddingRight={1} backgroundColor={theme.base} flexDirection="column">
        <text fg={theme.warning}><b>Account data · {account().name}</b></text>
        <text fg={theme.text}>c clear this account’s transactions</text>
        <text fg={theme.error}>x remove this account and its transactions</text>
        <text fg={theme.overlay1}>Press del to confirm either action · esc cancel</text>
      </box>}</Show>
    </box>
  )
}
