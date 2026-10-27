import { For, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { muted } from "../primitives/spans"
import { S } from "../primitives/S"
import { TextInput } from "../primitives/TextInput"
import { smartQuestionFor, ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { filterExprString } from "../../domain/filter"
import type { Account } from "../../domain/types"
import { fit, truncate } from "../text"
import { categoryMark } from "../icons"
import { ACCEPT_ALL_AT } from "../../domain/questions"
import { accountStacks, selectedAccounts } from "../../domain/accountTree"
import { AccountsPane, accountsPaneHeight } from "./AccountsPane"
import { TransactionTable } from "./TransactionTable"
import { MerchantTable } from "./MerchantTable"
import { groupByMerchant, sortMerchantGroups } from "../../domain/merchants"
import { TransactionDetail } from "./TransactionDetail"
import { Modal } from "../primitives/Modal"

export function ManagerTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  const rows = createMemo(() => data.scopedTransactions())
  const highlighted = createMemo(() => ui.highlightedIds(rows()))
  const showAccount = () => selectedAccounts(data.state.accounts, data.state.accountSelection).length > 1

  createEffect(() => {
    // App chrome (4), the accounts pane, transaction borders (2), and the
    // table header (1) are fixed. The viewport consumes every remaining row.
    const vis = Math.max(1, dims().height - 7 - accountsPaneHeight(accountStacks(data.state.accounts)) - (filterBar() ? 1 : 0))
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
  const groups = createMemo(() => (merchants() ? sortMerchantGroups(groupByMerchant(rows()), ui.state.merchantSort, ui.state.merchantReverse) : []))
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
    // Confidence is the suggestion's, shown in the Category column.
    const sorted = data.state.sortColumn === "confidence" ? "category" : data.state.sortColumn
    if (sorted !== col) return ""
    return data.state.sortAscending ? " ▲" : " ▼"
  }

  const asking = () => {
    const a = data.state.asking
    return a ? `asking Jev "${a.words}" ${a.judged}/${a.total}…` : null
  }

  /** With ask: terms, how many match and how many more are near misses. */
  const askNote = () => {
    const c = data.askCounts()
    if (!c || data.state.asking) return null
    return data.state.askLoose ? `${c.matches} match + ${c.near} near` : c.near ? `${c.matches} match · ${c.near} near (n)` : null
  }

  const scrollIndicator = () => {
    const text = [asking(), askNote(), rowsIndicator()].filter(Boolean).join(" · ")
    return text || undefined
  }

  const rowsIndicator = () => {
    if (merchants()) {
      if (groups().length === 0) return undefined
      return `${groups().length} merchants · ${rows().length} transactions · by ${ui.state.merchantSort}${ui.state.merchantReverse ? "↑" : "↓"}`
    }
    if (rows().length === 0) return undefined
    if (data.state.uncategorisedOnly) {
      const suggested = rows().filter((r) => data.state.suggestions[r.id]).length
      const confident = rows().filter((r) => (data.state.suggestions[r.id]?.confidence ?? 0) >= ACCEPT_ALL_AT).length
      return `${rows().length} to categorise · ${suggested} suggested, ${confident} ≥${ACCEPT_ALL_AT * 100}%${data.state.suggesting ? " · suggesting…" : ""}${
        selCount() > 0 ? ` · ${selCount()} selected` : ""}`
    }
    const start = ui.state.managerTop + 1
    const end = Math.min(ui.state.managerTop + ui.state.managerVisible, rows().length)
    // With a filter: how many the account has in all, and selected rows the
    // filter hides (Go app).
    const total = data.state.filterQuery ? data.accountScoped().length : rows().length
    const shown = new Set(rows().map((r) => r.id))
    const hidden = Object.keys(ui.state.selectedIds).filter((id) => !shown.has(Number(id))).length
    return `showing ${start}-${end} of ${rows().length}${total !== rows().length ? ` (${total.toLocaleString("en-AU")} in all)` : ""}${
      selCount() > 0 ? ` · ${selCount()} selected${hidden ? `, ${hidden} hidden` : ""}` : ""
    }${ui.state.rangeSelecting ? " · range" : ""} · sort ${data.state.sortColumn}${
      data.state.sortAscending ? "↑" : "↓"
    }`
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
    // The question a smart search turned into this filter, while it still is that filter.
    const question = smartQuestionFor(ui.state, raw)
    return { editing, raw, err, dotColor, dotLabel, preview, question }
  }

  /** The title names the filter: by its question when a smart search wrote it. */
  const filterTitle = () => {
    const fb = filterBar()
    if (fb?.question) return `[?${truncate(fb.question, 47)}]`
    if (!fb?.preview) return undefined
    return `[${truncate(fb.preview, 48)}]`
  }

  const accountAction = () => data.state.accounts.find((account) => account.id === ui.state.accountActionId)

  /** Accept-all's preview: how many rows go to each suggested category. */
  const acceptGroups = createMemo(() => {
    const counts = new Map<number, number>()
    for (const id of ui.state.acceptPreview ?? []) {
      const s = data.state.suggestions[id]
      if (s) counts.set(s.categoryId, (counts.get(s.categoryId) ?? 0) + 1)
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ category: data.state.categories.find((c) => c.id === id), n }))
  })
  const ACCEPT_LINES = 10

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.canvas}>
      <AccountsPane focused={acctFocused()} width={dims().width} />
      <SectionCard
        title={`Transactions${data.state.uncategorisedOnly ? " · uncategorised" : ""}${merchants() ? " · by merchant" : ""}`}
        titleSuffix={filterTitle()}
        titleSuffixColor={data.state.filterErr ? theme.error : theme.blue}
        focused={txFocused()}
        active={txFocused()}
        flexGrow={1}
        bottomSpans={scrollIndicator() ? [muted(scrollIndicator()!)] : []}
      >
        <Show when={filterBar()}>
          {(fb: () => NonNullable<ReturnType<typeof filterBar>>) => (
            <text>
              <S fg={theme.accent} bold>
                /
              </S>
              <S fg={theme.text}>{" "}</S>
              <TextInput field={{ value: fb().raw, caret: ui.state.filterCaret }} focused={fb().editing} caretColor={theme.accent} />
              <S fg={theme.text}>{"  "}</S>
              <S fg={fb().dotColor}>●</S>
              <S fg={fb().dotColor}> {fb().dotLabel}</S>
              {fb().question ? <S fg={theme.overlay1}>{fb().editing ? `  ↑ ?${fb().question}` : `  from ?${fb().question}`}</S> : null}
              {!fb().editing ? <S fg={theme.overlay1}>{ui.state.drillReturn ? "  (esc back · u clear)" : "  (esc clear)"}</S> : null}
            </text>
          )}
        </Show>
        <Show when={merchants()}>
          <MerchantTable
            groups={groups()}
            top={ui.state.merchantTop}
            visible={ui.state.managerVisible}
            cursor={txFocused() && !ui.state.filterMode ? ui.state.merchantCursor : null}
            width={dims().width - 4}
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
          width={dims().width - 4}
          showAccount={showAccount()}
          showTags
          selectedIds={ui.state.selectedIds}
          highlighted={highlighted()}
          sortMark={sortMark}
          empty={data.state.uncategorisedOnly ? "Nothing to categorise" : data.state.filterQuery ? "No matches" : "Empty · no transactions loaded"}
          suggestions={data.state.uncategorisedOnly ? data.state.suggestions : undefined}
          askScore={data.state.askLoose ? data.askScore : undefined}
        />
        </Show>
      </SectionCard>
      <TransactionDetail />
      <Show when={ui.state.acceptPreview}>
        {(ids: () => number[]) => (
          <Modal title="Accept suggestions" subtitle={`${ids().length} at ${ACCEPT_ALL_AT * 100}% or more`} width={56} hints="enter accept · esc cancel">
            <For each={acceptGroups().slice(0, ACCEPT_LINES)}>{(g) => (
              <text wrapMode="none">
                <S fg={g.category?.color ?? theme.text}>{`${categoryMark(g.category?.id ?? null)} `}</S>
                <S fg={theme.text}>{fit(g.category?.name ?? "?", 36)}</S>
                <S fg={theme.subtext0}>{String(g.n).padStart(6)}</S>
              </text>
            )}</For>
            <Show when={acceptGroups().length > ACCEPT_LINES}>
              <text fg={theme.overlay1}>{`and ${acceptGroups().length - ACCEPT_LINES} more ${acceptGroups().length - ACCEPT_LINES === 1 ? "category" : "categories"}`}</text>
            </Show>
            <text> </text>
            <text fg={theme.overlay1}>Up rows are categorised in Up too.</text>
          </Modal>
        )}
      </Show>
      <Show when={accountAction()}>
        {(account: () => Account) => (
          <Modal title="Account data" subtitle={account().name} tone="warning" width={56} hints="del confirms either action · esc cancel">
            <text fg={theme.text}>c clear this account’s transactions</text>
            <text fg={theme.error}>x remove this account and its transactions</text>
          </Modal>
        )}
      </Show>
    </box>
  )
}
