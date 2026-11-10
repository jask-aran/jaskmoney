import type { BoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo } from "solid-js"
import { selectedAccounts } from "../../domain/accountTree"
import { askTerms, filterExprString } from "../../domain/filter"
import { groupByMerchant, sortMerchantGroups } from "../../domain/merchants"
import { ACCEPT_ALL_AT } from "../../domain/questions"
import { data } from "../../state/dataStore"
import { smartQuestionFor, ui, type SectionId } from "../../state/uiStore"
import { theme } from "../../theme"
import { chartSpeedMs, showings, useReveal } from "../charts/motion"
import { truncate } from "../text"
import { type TableTagCandidate } from "./TransactionTable"
import { rowsShown, rowsToCategorise, type FilterBarView } from "./TransactionsPane"

export function createManagerRows() {
  const dims = useTerminalDimensions()
  const rows = createMemo(() => data.scopedTransactions())
  const tabShowings = showings(() => ui.state.activeTab === "manager")
  const rowsReveal = useReveal(
    () => (data.state.uiPrefs.chartMotion === "always" ? String(tabShowings()) : undefined),
    () => chartSpeedMs(data.state.uiPrefs.chartSpeed), () => data.state.uiPrefs.chartCurve)
  const highlighted = createMemo(() => ui.highlightedIds(rows()))
  const showAccount = () => selectedAccounts(data.state.accounts, data.state.accountSelection).length > 1

  const measureTables = (box: BoxRenderable) => {
    box.onSizeChange = () => {
      const vis = Math.max(1, box.height - 1)
      if (vis !== ui.state.managerVisible) ui.setState({ managerVisible: vis })
    }
  }

  createEffect(() => {
    const n = rows().length
    if (n === 0 && ui.state.managerCursor !== 0) {
      ui.setState({ managerCursor: 0, managerTop: 0 })
    } else if (n > 0 && ui.state.managerCursor >= n) {
      ui.jumpManagerCursor(n - 1, n)
    }
  })

  const view = () => JSON.stringify([data.state.sortColumn, data.state.sortAscending, data.state.filterQuery, data.state.accountSelection, data.state.uncategorisedOnly, data.state.tagReview?.name ?? null])
  let seen: { view: string; index: number; id: number | undefined } | null = null
  createEffect(() => {
    const list = rows(), now = view(), index = ui.state.managerCursor
    const was = seen
    if (was && was.view === now && was.index === index && was.id != null && list[index]?.id !== was.id && ui.state.range == null) {
      const at = list.findIndex((t) => t.id === was.id)
      if (at >= 0) {
        seen = { view: now, index: at, id: was.id }
        ui.jumpManagerCursor(at, list.length)
        return
      }
    }
    seen = { view: now, index, id: list[index]?.id }
  })

  createEffect(() => {
    const maxTop = Math.max(0, rows().length - ui.state.managerVisible)
    if (ui.state.managerTop > maxTop) ui.setState({ managerTop: maxTop })
  })
  return { rows, dims, measureTables, rowsReveal, showAccount, highlighted }
}

export function createMerchantRows(input: Pick<ReturnType<typeof createManagerRows>, "rows"> & { props: { focused: SectionId } }) {
  const { rows, props } = input

  const merchants = () => ui.state.txnView === "merchants"
  const groups = createMemo<ReturnType<typeof groupByMerchant>>((was) => (merchants() || was === undefined
    ? sortMerchantGroups(groupByMerchant(rows()), ui.state.merchantSort, ui.state.merchantReverse) : was))
  const tableRows = createMemo<ReturnType<typeof rows>>((was) => (!merchants() || was === undefined ? rows() : was))
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
    const sorted = data.state.sortColumn === "confidence" ? (data.state.tagReview ? "" : "category") : data.state.sortColumn
    if (sorted !== col) return ""
    return data.state.sortAscending ? " ▲" : " ▼"
  }

  return { merchants, groups, selCount, txFocused, tableRows, sortMark, acctFocused }
}

export function createManagerIndicator(input: Pick<ReturnType<typeof createManagerRows>, "rows"> & Pick<ReturnType<typeof createMerchantRows>, "merchants" | "groups" | "selCount">) {
  const { rows, merchants, groups, selCount } = input
  const asking = () => {
    const a = data.state.asking
    return a ? `asking Jev "${a.words}" ${a.judged}/${a.total}…` : null
  }

  const askNote = () => {
    const c = data.askCounts()
    if (!c || data.state.asking) return null
    return data.nearMissesShown() ? `${c.matches} match, then ${c.near} near (≈)` : c.near ? `${c.matches} match · ${c.near} near (n)` : null
  }

  const hiddenSelected = createMemo(() => {
    const shown = new Set(rows().map((r) => r.id))
    return Object.keys(ui.state.selectedIds).filter((id) => !shown.has(Number(id))).length
  })
  const rowsIndicator = () => {
    if (merchants()) {
      if (groups().length === 0) return undefined
      return `${groups().length} merchants · ${rows().length} transactions · by ${ui.state.merchantSort}${ui.state.merchantReverse ? "↑" : "↓"}`
    }
    const review = data.state.tagReview
    if (review) {
      const sure = rows().filter((r) => (review.candidates[r.id]?.confidence ?? 0) >= ACCEPT_ALL_AT).length
      return `${rows().length} to review for ${review.name}, ${sure} ≥${ACCEPT_ALL_AT * 100}%${review.asking ? " · asking Jev…" : ""}${selCount() > 0 ? ` · ${selCount()} selected` : ""}`
    }
    if (data.state.uncategorisedOnly) return rowsToCategorise({
      count: rows().length,
      suggested: rows().filter((r) => data.state.suggestions[r.id]).length,
      confident: rows().filter((r) => (data.state.suggestions[r.id]?.confidence ?? 0) >= ACCEPT_ALL_AT).length,
      suggesting: data.state.suggesting, selected: selCount(), hidden: hiddenSelected(),
    })
    return rowsShown({
      top: ui.state.managerTop, visible: ui.state.managerVisible, count: rows().length,
      total: data.state.filterQuery ? data.accountScoped().length : rows().length,
      selected: selCount(), hidden: hiddenSelected(), range: ui.state.range != null,
      sort: data.state.sortColumn, ascending: data.state.sortAscending,
    })
  }

  const scrollIndicator = createMemo(() => {
    const text = [asking(), askNote(), rowsIndicator()].filter(Boolean).join(" · ")
    return text || undefined
  })
  return { scrollIndicator }
}

export function createManagerFilter() {

  const filterBar = (): FilterBarView | null => {
    const editing = (ui.state.filterBar != null)
    const raw = editing ? (ui.state.filterBar?.draft ?? "") : data.state.filterQuery
    if (!editing && !raw.trim()) return null
    return {
      editing, raw, caret: ui.state.filterBar?.caret ?? 0,
      err: data.state.filterErr, note: data.state.filterNote,
      question: smartQuestionFor(ui.state, raw),
      jev: !(editing && raw.trimStart().startsWith("?")) && askTerms(data.state.filterExpr).length > 0,
      writing: ui.state.smartWriting,
      drillReturn: !!ui.state.drillReturn,
      preview: data.filterPreview() || (data.state.filterExpr ? filterExprString(data.state.filterExpr) : raw),
    }
  }
  return { filterBar }
}

export function createManagerPreviews() {

  const accountAction = () => data.state.accounts.find((account) => account.id === (ui.state.accountAction?.id ?? null))

  const acceptGroups = createMemo(() => {
    if (!ui.state.acceptPreview?.length) return []
    const groups = new Map<number, Map<string, number>>()
    const byId = new Map(data.transactions().map((t) => [t.id, t]))
    for (const id of ui.state.acceptPreview ?? []) {
      const s = data.state.suggestions[id], t = byId.get(id)
      if (!s || !t) continue
      const rows = groups.get(s.categoryId) ?? new Map<string, number>()
      const item = t.bought?.[0]?.name
      const label = `${item ? truncate(item, 28) : t.description.trim()}${t.amount > 0 ? " (in)" : ""}`
      rows.set(label, (rows.get(label) ?? 0) + 1)
      groups.set(s.categoryId, rows)
    }
    return [...groups].map(([id, rows]) => ({
      category: data.state.categories.find((c) => c.id === id),
      n: [...rows.values()].reduce((a, b) => a + b, 0),
      rows: [...rows].sort((a, b) => b[1] - a[1]).map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)).join(", "),
    })).sort((a, b) => b.n - a.n)
  })
  const ACCEPT_LINES = 8
  const RULE_LINES = 6
  const ruleOffers = createMemo(() => (ui.state.ruleOffers !== null ? data.allRuleOffers() : []))
  const ruleTop = () => Math.max(0, ui.state.ruleOffers!.cursor - RULE_LINES + 1)

  const tagPreview = createMemo(() => {
    if (!ui.state.acceptPreview?.length) return []
    const byId = new Map(data.transactions().map((t) => [t.id, t]))
    const counts = new Map<string, number>()
    for (const id of ui.state.acceptPreview ?? []) {
      const t = byId.get(id)
      if (!t) continue
      const label = `${t.description.trim()}${t.amount > 0 ? " (in)" : ""}`
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([label, n]) => (n > 1 ? `${label} ×${n}` : label))
  })

  const tagCandidate = (id: number): TableTagCandidate | undefined => {
    const review = data.state.tagReview
    const c = review?.candidates[id]
    if (!review || !c) return undefined
    const tag = review.tagId != null ? data.state.tags.find((t) => t.id === review.tagId) : undefined
    return { name: review.name, color: tag?.color ?? theme.blue, confidence: c.confidence, source: c.source }
  }
  return { tagCandidate, tagPreview, ACCEPT_LINES, acceptGroups, ruleOffers, ruleTop, RULE_LINES, accountAction }
}
