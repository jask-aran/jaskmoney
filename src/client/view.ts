import { createMemo, createRoot } from "solid-js"
import { unwrap } from "solid-js/store"
import { chronological } from "../domain/chronology"
import { normaliseSelection, type AccountSelection } from "../domain/accountTree"
import { applyTop, evalFilter, askTerms, filterExprString, canonicalFilter, reparseFilterInput, filterNote, liveFilter, type FilterNames } from "../domain/filter"
import { MATCH_AT, NEAR_AT } from "../domain/questions"
import type { SortColumn, Transaction } from "../domain/types"
import type { createAskState, createAskCounts } from "./ask"
import type { createHistoryRows } from "./derived"
import type { SetStoreFunction } from "solid-js/store"
import type { DataState } from "./store"

const SORT_CYCLE: SortColumn[] = [
  "date",
  "amount",
  "description",
  "category",
  "account",
]

const textOrder = new Intl.Collator().compare

function sortRows(rows: Transaction[], col: SortColumn, asc: boolean, confidence: (id: number) => number = () => -1): Transaction[] {
  const byDate = chronological
  const compare = (a: Transaction, b: Transaction): number => {
    switch (col) {
      case "confidence": return confidence(a.id) - confidence(b.id) || byDate(a, b)
      case "date": return byDate(a, b)
      case "amount": return a.amount - b.amount
      case "description": return textOrder(a.description, b.description)
      case "category": return textOrder(a.categoryName, b.categoryName)
      case "account": return textOrder(a.accountName, b.accountName)
    }
  }
  return rows.slice().sort((a, b) => (asc ? compare(a, b) : -compare(a, b)))
}

export function createTableRows(state: DataState, accountScoped: ReturnType<typeof createHistoryRows>["accountScoped"], inView: (t: Transaction) => boolean, ask: ReturnType<typeof createAskState>, nearMissesShown: ReturnType<typeof createAskCounts>["nearMissesShown"]) {
  const { askVersion, verdictAt } = ask
  const nearMissIds = createRoot(() => createMemo(() => {
    const expr = state.filterExpr ? unwrap(state.filterExpr) : null
    if (!nearMissesShown() || !expr) return new Set<number>()
    askVersion()
    return new Set(filtered().filter((t) => !evalFilter(expr, t, verdictAt(MATCH_AT))).map((t) => t.id))
  }))

  const filtered = createRoot(() => createMemo(() => {
    const expr = state.filterExpr ? unwrap(state.filterExpr) : null
    const rows = accountScoped()
    if (!expr && !state.uncategorisedOnly && !state.tagReview) return rows
    const asks = askTerms(expr).length > 0
    if (asks) askVersion()
    const matches = applyTop(expr, rows.filter((t) => inView(t) && (!expr || evalFilter(expr, t, verdictAt(MATCH_AT)))))
    if (!asks || !nearMissesShown()) return matches
    const near = rows.filter((t) => inView(t) && evalFilter(expr, t, verdictAt(NEAR_AT)) && !evalFilter(expr, t, verdictAt(MATCH_AT)))
    return [...matches, ...applyTop(expr, near)]
  }))

  const sortedAt = new Map<number, number>()
  let sortedFor = ""

  const scopedTransactions = createRoot(() => createMemo(() => {
    const review = state.tagReview
    const live = state.sortColumn !== "confidence" ? undefined
      : review ? (id: number) => review.candidates[id]?.confidence ?? -1
      : (id: number) => state.suggestions[id]?.confidence ?? -1
    const view = `${state.demo}|${state.uncategorisedOnly}|${review?.name ?? ""}|${state.sortColumn}`
    if (view !== sortedFor) { sortedAt.clear(); sortedFor = view }
    const confidence = live && ((id: number) => {
      const now = live(id), held = sortedAt.get(id)
      if (held !== undefined && held <= now) return held
      if (held !== undefined || now >= 0) sortedAt.set(id, now)
      return now
    })
    const sorted = sortRows(filtered(), state.sortColumn, state.sortAscending, confidence)
    const near = nearMissIds()
    return near.size ? [...sorted.filter((t) => !near.has(t.id)), ...sorted.filter((t) => near.has(t.id))] : sorted
  }))

  return { nearMissIds, scopedTransactions }
}

export function createViewControls(state: DataState, setState: SetStoreFunction<DataState>, askRuns: ReturnType<typeof createAskState>["askRuns"]) {
  function filterNames(): FilterNames {
    return { cat: state.categories.map((c) => c.name), tag: state.tags.map((t) => t.name), acc: state.accounts.map((a) => a.name) }
  }

  function setFilterLive(q: string) {
    const { expr, err, note } = liveFilter(q, filterNames())
    setState({ filterQuery: q, filterExpr: expr, filterErr: err, filterNote: note })
  }

  function commitFilter(q: string): { ok: boolean; err: string } {
    const trimmed = q.trim()
    if (!trimmed) {
      clearFilter()
      return { ok: true, err: "" }
    }
    const names = filterNames()
    const live = reparseFilterInput(trimmed, names)
    const err = live.err || canonicalFilter(trimmed, names).error || ""
    setState({
      filterQuery: trimmed,
      filterExpr: live.expr,
      filterErr: err,
      filterNote: filterNote(trimmed, live.err, live.hints, names),
    })
    return { ok: !err, err }
  }

  function clearFilter() {
    askRuns.stop()
    setState({
      asking: null,
      askLoose: null,
      filterQuery: "",
      filterExpr: null,
      filterErr: "",
      filterNote: null,
    })
  }

  function filterPreview(): string {
    if (state.filterExpr) return filterExprString(state.filterExpr)
    return state.filterQuery
  }

  function cycleSortColumn(): string {
    const cycle: SortColumn[] = state.uncategorisedOnly || state.tagReview ? ["confidence", ...SORT_CYCLE] : SORT_CYCLE
    const i = cycle.indexOf(state.sortColumn)
    const next = cycle[(i + 1) % cycle.length]!
    setState({ sortColumn: next })
    return next
  }

  function toggleSortDirection(): boolean {
    const next = !state.sortAscending
    setState({ sortAscending: next })
    return next
  }

  function setAccountSelection(selection: AccountSelection) {
    setState({ accountSelection: normaliseSelection(state.accounts, selection) })
  }

  return { setFilterLive, commitFilter, clearFilter, filterPreview, cycleSortColumn, toggleSortDirection, setAccountSelection }
}
