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
import { TransactionTable } from "./TransactionTable"
import { MerchantTable } from "./MerchantTable"
import { groupByMerchant, sortMerchantGroups } from "../../domain/merchants"
import { categoryMark } from "../icons"
import { TransactionDetail } from "./TransactionDetail"

/** Sidebar width, borders included. */
export const SIDEBAR_WIDTH = 36
/** Below this width the sidebar folds into a one-line account header. */
const WIDE = 110

export function ManagerTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  const rows = createMemo(() => data.scopedTransactions())
  const highlighted = createMemo(() => ui.highlightedIds(rows()))
  const entries = createMemo(() => sidebarEntries(data.state.accounts))
  const showAccount = () => selectedAccounts(data.state.accounts, data.state.accountSelection).length > 1
  const wide = () => dims().width >= WIDE
  const stats = createMemo(() => computeAccountStats(selectedAccounts(data.state.accounts, data.state.accountSelection), data.state.transactions, toISODate(new Date())))

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


  // Merchant view: the same rows grouped, with its own cursor kept in view.
  const merchants = () => ui.state.txnView === "merchants"
  const groups = createMemo(() => sortMerchantGroups(groupByMerchant(rows()), ui.state.merchantSort, ui.state.merchantReverse))
  createEffect(() => {
    if (!merchants()) return
    const n = ui.state.managerVisible
    const cur = Math.min(ui.state.merchantCursor, Math.max(0, groups().length - 1))
    if (cur !== ui.state.merchantCursor) ui.setState({ merchantCursor: cur })
    if (cur < ui.state.merchantTop) ui.setState({ merchantTop: cur })
    else if (cur >= ui.state.merchantTop + n) ui.setState({ merchantTop: cur - n + 1 })
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
    if (merchants()) {
      if (groups().length === 0) return undefined
      return `─ ${groups().length} merchants · ${rows().length} transactions · by ${ui.state.merchantSort}${ui.state.merchantReverse ? "↑" : "↓"} ─`
    }
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
        <SectionCard title="Accounts" focused={acctFocused()} active={acctFocused()} flexGrow={1}>
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
      </box>
      </Show>

      <SectionCard
        title={merchants() ? "Transactions · by merchant" : "Transactions"}
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
        <Show when={merchants()}>
          <MerchantTable
            groups={groups()}
            top={ui.state.merchantTop}
            visible={ui.state.managerVisible}
            cursor={txFocused() && !ui.state.filterMode ? ui.state.merchantCursor : null}
            width={dims().width - (wide() ? SIDEBAR_WIDTH + 1 : 0) - 4}
            sort={ui.state.merchantSort}
            reverse={ui.state.merchantReverse}
            empty={data.state.filterQuery ? "No matches" : "Empty · no transactions loaded"}
          />
        </Show>
        <Show when={!merchants()}>
        <TransactionTable
          rows={rows()}
          top={ui.state.managerTop}
          visible={ui.state.managerVisible}
          cursor={txFocused() && !ui.state.filterMode ? ui.state.managerCursor : null}
          width={dims().width - (wide() ? SIDEBAR_WIDTH + 1 : 0) - 4}
          showAccount={showAccount()}
          showTags
          selectedIds={ui.state.selectedIds}
          highlighted={highlighted()}
          sortMark={sortMark}
          empty={data.state.filterQuery ? "No matches" : "Empty · no transactions loaded"}
        />
        </Show>
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
