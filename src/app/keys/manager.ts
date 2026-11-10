import { toTransactions, clearTransactionFilter, askForRules, reportError, settleData, runUndo } from "../actions"
import { ACCOUNT_ACTIONS } from "../../state/armed"
import { type KeyEvent } from "@opentui/core"
import { accountStacks } from "../../domain/accountTree"
import { RULE_AFTER } from "../../domain/ruleOffers"
import { endTagReview, runTagAccept } from "../tagReview"
import { MERCHANT_SORTS, groupByMerchant, merchantFilter, sortMerchantGroups } from "../../domain/merchants"
import { askTerms } from "../../domain/filter"
import { BOUGHT_LINES } from "../../ui/manager/TransactionDetail"
import { runAccept, toggleUncategorised } from "../suggest"
import { ACCEPT_ALL_AT } from "../../domain/questions"
import { type ScopeId, type UiStore } from "../../state/uiStore"
import type { DataStore } from "../../state/dataStore"
import { editText } from "../../domain/textField"
import { count } from "../../ui/text"
import { moveTxnCursor, listMove, isJump, openCategoryPicker, openMerchantNote, confirmTwice, isSmartSearchKey, openSmartSearch, openTransaction, selectAccountRow, savedFilterKeys, type ScopeEntry, stepAccount } from "./shared"

function handleManagerDetailNotes(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const detail = ui.state.detail
  if (!detail?.notes) return
  const { name } = key
  if (name === "escape") { ui.setState("detail", { notes: null }); ui.setStatus("Notes unchanged"); return }
  if (name === "return" || name === "enter") {
    const asking = data?.updateTransactionNotes(detail.id, detail.notes.draft.trim())
    ui.setStatus("Notes saved")
    if (asking) settleData(ui, asking, (asked) => { if (asked) ui.setStatus("Notes saved · suggestion asked again with them") })
    ui.setState("detail", { notes: null })
    return
  }
  const next = editText({ value: detail.notes.draft, caret: detail.notes.caret }, key)
  if (next) ui.setState("detail", { notes: { draft: next.value, caret: next.caret } })
}

function handleManagerDetail(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key

  if (name === "escape" || name === "return" || name === "enter") { ui.setState({ detail: null }); return }
  if (name === "c") { openCategoryPicker(ui, ui.targetIds(data?.scopedTransactions() ?? []), data); return }
  if (name === "t") { ui.openTagPicker(ui.targetIds(data?.scopedTransactions() ?? [])); return }
  if ((name === "N" || (name === "n" && key.shift)) && data) {
    const row = data.transactions().find((t) => t.id === (ui.state.detail?.id ?? null))
    if (row) { ui.setState({ detail: null }); openMerchantNote(ui, data, row.description) }
    return
  }
  if (name === "n") {
    const notes = data?.transactions().find((t) => t.id === (ui.state.detail?.id ?? null))?.notes ?? ""
    ui.setState("detail", { notes: { draft: notes, caret: notes.length } })
    return
  }
  // J/K scroll what it bought, when that's longer than the view shows.
  if ((name === "j" || name === "k" || name === "J" || name === "K") && (key.shift || name === "J" || name === "K")) {
    const items = data?.transactions().find((t) => t.id === (ui.state.detail?.id ?? null))?.bought?.length ?? 0
    const top = (ui.state.detail?.boughtTop ?? 0) + (name.toLowerCase() === "j" ? 1 : -1)
    ui.setState("detail", { boughtTop: Math.max(0, Math.min(top, items - BOUGHT_LINES)) })
    return
  }
  // j/k browse neighbouring transactions without closing the view.
  if (name === "j" || name === "down" || name === "k" || name === "up") {
    const rows = data?.scopedTransactions() ?? []
    moveTxnCursor(ui, data, name === "j" || name === "down" ? 1 : -1, false)
    const row = rows[ui.state.managerCursor]
    if (row) ui.setState({ detail: { id: row.id, boughtTop: 0, notes: null } })
    return
  }
}

function handleManagerAccountAction(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "escape") { ui.setState({ accountAction: null }); ui.setStatus("Account actions cancelled"); return }
  const account = data?.state.accounts.find((a) => a.id === (ui.state.accountAction?.id ?? null))
  const moved = listMove(key, (ui.state.accountAction?.cursor ?? 0), ACCOUNT_ACTIONS.length)
  if (moved != null) { ui.setState("accountAction", { cursor: moved }); return }
  if ((name === "return" || name === "enter") && account) {
    const kind = ACCOUNT_ACTIONS[(ui.state.accountAction?.cursor ?? 0)]!
    const opened = ui.opening("accountAction")
    confirmTwice(ui, data, { kind, id: account.id, label: account.name, with: "enter" }, () => opened.close())
  }
}

/** Accept-all's preview: enter (or y) accepts those rows, esc doesn't. */
function handleManagerAcceptPreview(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  const ids = ui.state.acceptPreview ?? []
  if (name === "escape") { ui.setState({ acceptPreview: null }); ui.setStatus("Nothing accepted"); return }
  if ((name === "return" || name === "enter" || name === "y") && data) {
    ui.setState({ acceptPreview: null })
    // The same preview serves a tag review and the Uncategorised view.
    void (data.state.tagReview ? runTagAccept(ui, data, ids) : runAccept(ui, data, ids))
  }
}

/** R: rules offered from repeated categorisations. enter makes the cursor's,
 * x declines it for good, esc closes (offers stay). */
function handleRuleOffers(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const dialog = ui.state.ruleOffers
  if (!dialog) return
  const opened = ui.opening("ruleOffers")
  const { name } = key
  const offers = data?.allRuleOffers() ?? []
  const close = () => opened.close()
  if (name === "escape") { close(); ui.setStatus("Transactions"); return }
  if (dialog.busy && ["return", "enter", "x"].includes(name)) return
  // The final action row asks the general model for more rules.
  if ((name === "return" || name === "enter") && dialog.cursor === offers.length && !!data?.state.llm && data) {
    askForRules(ui, data)
    return
  }
  const moved = listMove(key, dialog.cursor, offers.length + (data?.state.llm ? 1 : 0))
  if (moved != null) { ui.setState("ruleOffers", { cursor: moved }); return }
  const offer = offers[dialog.cursor]
  if (!offer || !data) return
  const settle = () => {
    if (!opened.open) return
    const left = data.allRuleOffers().length + (data?.state.llm ? 1 : 0)
    if (!left) close()
    else opened.patch({ cursor: Math.min(dialog.cursor, left - 1), busy: false })
  }
  if (name === "return" || name === "enter") {
    ui.setStatus(`Making a rule for ${offer.description}…`)
    opened.patch({ busy: true })
    data.makeOfferedRule(offer).then(
      (summary) => { settle(); ui.jumpManagerCursor(Math.min(ui.state.managerCursor, Math.max(0, data.scopedTransactions().length - 1)), data.scopedTransactions().length); ui.setStatus(summary) },
      (e) => { opened.patch({ busy: false }); reportError(ui, e) },
    )
    return
  }
  if (name === "x" && !key.shift) {
    opened.patch({ busy: true })
    settleData(ui, (async () => {
      try {
        await data.declineRuleOffer(offer)
        settle()
        ui.setStatus(`No rule for ${offer.description}; it won't be offered again`)
      } finally { opened.patch({ busy: false }) }
    })())
  }
}

/** esc in Transactions steps back one level (K3): the selection, then a
 * drill-down (back to Overview: its filter is the drill), then the filter,
 * then a special view (tag review, then the Uncategorised view). Approved
 * OpenTUI deviation from legacy, where u cleared and views had own keys. */
function stepBack(ui: UiStore, data?: DataStore): void {
  if (Object.keys(ui.state.selectedIds).length || (ui.state.range != null)) { ui.clearSelection(); ui.setStatus("Selection cleared"); return }
  if (!data) return
  const back = ui.state.drillReturn
  if (back) {
    if (back.filter) data.commitFilter(back.filter)
    else data.clearFilter()
    ui.switchTab("overview")
    ui.setState({ focusedSection: back.focus })
    ui.setStatus("Overview")
    return
  }
  if (data.state.filterQuery) { clearTransactionFilter(ui, data); return }
  if (data.state.tagReview) { endTagReview(ui, data); return }
  if (data.state.uncategorisedOnly) { toggleUncategorised(ui, data); return }
  ui.setStatus("Nothing to clear")
}

/** The table's rows (scopedTransactions), read once per key. */
type Rows = ReturnType<DataStore["scopedTransactions"]>

/** The table's commands: saved filters, undo, repeat, the account, merchants,
 * notes, near misses and rule offers. */
function txnsCommandKeys(ui: UiStore, key: KeyEvent, rows: Rows, data?: DataStore): boolean {
  const { name, sequence: seq } = key
  if (savedFilterKeys(ui, data, key)) return true
  // u undoes the last change (dataStore.undo); esc clears, below.
  if (name === "u" && data) { runUndo(ui, data); return true }

  if ((name === "." || seq === ".") && data) {
    if (!data.lastRepeat()) { ui.setStatus("Nothing to repeat"); return true }
    settleData(ui, data.repeatLast(ui.targetIds(rows)), (summary) => ui.setStatus(summary, summary.includes("failed:")))
    return true
  }

  // Step through the accounts pane from the table.
  if (name === "a" && !key.shift && data) { stepAccount(ui, data); return true }
  if (name === "m") { ui.setState({ txnView: "merchants", merchantCursor: 0, merchantTop: 0 }); ui.setStatus("Grouped by merchant · m for rows"); return true }
  // N: a note on the row's merchant (what you buy there), for suggestions.
  if ((name === "N" || (name === "n" && key.shift)) && data) {
    const row = data.scopedTransactions()[ui.state.managerCursor]
    if (row) openMerchantNote(ui, data, row.description)
    return true
  }
  // With ask: terms, n shows near misses too (rows Jev hasn't settled).
  if (name === "n" && !key.shift && data && askTerms(data.state.filterExpr).length) {
    const on = !data.nearMissesShown()
    data.setAskLoose(on)
    ui.jumpManagerCursor(0, data.scopedTransactions().length)
    const counts = data.askCounts()
    const tally = `${counts?.matches ?? 0} match, ${counts?.near ?? 0} near`
    ui.setStatus(on ? `${tally}: near misses below the matches (n hides them)` : `${tally}: matches only (n shows the near)`)
    return true
  }
  // R: rules offered from what you've categorised the same way repeatedly.
  if (name === "r" && key.shift && data) {
    const n = data.allRuleOffers().length
    // With a model to ask, the list opens on the final action row when empty.
    if (!n && !data?.state.llm) { ui.setStatus(`No rule to offer: one comes after you put a description in the same category ${RULE_AFTER} times`); return true }
    ui.setState({ ruleOffers: { cursor: 0, busy: false } })
    ui.setStatus(n ? `${count(n, "rule")} offered` : "No rules offered yet · enter asks the AI")
    return true
  }
  return false
}

/** Tag review and the Uncategorised view: their candidates and suggestions. */
function txnsReviewKeys(ui: UiStore, key: KeyEvent, rows: Rows, data?: DataStore): boolean {
  const { name } = key
  // Tag review: a tag's candidates, accepted (y, Y) or dismissed (x) like
  // category suggestions; T chooses another tag, esc leaves.
  if (name === "t" && key.shift && data) { ui.setState({ tagChooser: { cursor: 0, query: "" } }); ui.setStatus("Find transactions for a tag · type to filter or name a new one"); return true }
  const review = data?.state.tagReview
  if (review && data) {
    if (name === "y" && !key.shift) { void runTagAccept(ui, data, ui.targetIds(rows)); return true }
    if (name === "y" && key.shift) {
      const ids = rows.filter((r) => (review.candidates[r.id]?.confidence ?? 0) >= ACCEPT_ALL_AT).map((r) => r.id)
      if (!ids.length) { ui.setStatus(`No candidate is ${ACCEPT_ALL_AT * 100}% sure or more`); return true }
      ui.setState({ acceptPreview: ids })
      return true
    }
    if (name === "x" && !key.shift) {
      const ids = ui.targetIds(rows).filter((id) => review.candidates[id])
      settleData(ui, data.dismissTagCandidates(ids), () => {
        ui.clearSelection()
        ui.jumpManagerCursor(Math.min(ui.state.managerCursor, Math.max(0, data.scopedTransactions().length - 1)), data.scopedTransactions().length)
        ui.setStatus(ids.length ? `Dismissed ${count(ids.length, "candidate")} for this session` : "No candidate to dismiss")
      })
      return true
    }
  }
  // The Uncategorised view: rows waiting for a category, with suggestions
  // to accept (y: these rows, Y: every confident one) or dismiss (x).
  if (name === "i" && !key.shift && data) { if (review) data.closeTagReview(); toggleUncategorised(ui, data); return true }
  if (data?.state.uncategorisedOnly) {
    if (name === "y" && !key.shift) { void runAccept(ui, data, ui.targetIds(rows)); return true }
    if (name === "y" && key.shift) {
      // Several rows, possibly pushed to Up: show what it would do first.
      const ids = rows.filter((r) => (data.state.suggestions[r.id]?.confidence ?? 0) >= ACCEPT_ALL_AT).map((r) => r.id)
      if (!ids.length) { ui.setStatus(`No suggestion is ${ACCEPT_ALL_AT * 100}% sure or more`); return true }
      ui.setState({ acceptPreview: ids })
      return true
    }
    if (name === "x" && !key.shift) {
      const ids = ui.targetIds(rows).filter((id) => data.state.suggestions[id])
      settleData(ui, data.dismissSuggestions(ids), () => {
        ui.clearSelection()
        ui.setStatus(ids.length ? `Dismissed ${count(ids.length, "suggestion")}` : "No suggestion to dismiss")
      })
      return true
    }
  }
  return false
}

/** The row's detail, search and filter, stepping back, sort, category and tag. */
function txnsTableKeys(ui: UiStore, key: KeyEvent, rows: Rows, data?: DataStore): boolean {
  const { name, sequence: seq } = key
  if (name === "return" || name === "enter") {
    openTransaction(ui, data)
    return true
  }
  if (isSmartSearchKey(key)) { openSmartSearch(ui, data); return true }
  if (name === "/" || seq === "/") {
    ui.openFilter(data?.state.filterQuery ?? "")
    return true
  }
  if (name === "escape") { stepBack(ui, data); return true }
  if (name === "s" && !key.shift) {
    const col = data?.cycleSortColumn() ?? "date"
    ui.jumpManagerCursor(0, rows.length)
    ui.setStatus(`Sort: ${col} ${data?.state.sortAscending ? "↑" : "↓"}`)
    return true
  }
  if ((name === "s" && key.shift) || name === "S") {
    const asc = data?.toggleSortDirection() ?? false
    ui.setStatus(`Sort: ${data?.state.sortColumn ?? "date"} ${asc ? "↑" : "↓"}`)
    return true
  }
  if (name === "c") {
    if (rows.length === 0) {
      ui.setStatus("No row to categorize", true)
      return true
    }
    openCategoryPicker(ui, ui.targetIds(rows), data)
    return true
  }
  if (name === "t") {
    if (rows.length === 0) {
      ui.setStatus("No row to tag", true)
      return true
    }
    ui.openTagPicker(ui.targetIds(rows))
    return true
  }
  return false
}

/** Selection (space, over a range too) and the cursor. */
function txnsCursorKeys(ui: UiStore, key: KeyEvent, rows: Rows, data?: DataStore): void {
  const { name, sequence: seq } = key
  if (name === "space" || seq === " ") {
    const hl = ui.highlightedIds(rows)
    const hlIds = Object.keys(hl).map(Number)
    if ((ui.state.range != null) && hlIds.length > 0) {
      const allOn = hlIds.every((id) => ui.state.selectedIds[id])
      const next = { ...ui.state.selectedIds }
      for (const id of hlIds) {
        if (allOn) delete next[id]
        else next[id] = true
      }
      ui.setState({ selectedIds: next, range: null })
      ui.setStatus(allOn ? `Deselected ${hlIds.length}` : `Selected ${hlIds.length}`)
    } else {
      const row = rows[ui.state.managerCursor]
      if (row) {
        ui.toggleSelectedId(row.id)
      }
    }
    return
  }
  const moved = listMove(key, ui.state.managerCursor, rows.length, ui.state.managerVisible)
  if (moved != null) {
    if (isJump(key)) {
      ui.jumpManagerCursor(moved, rows.length)
      ui.setRangeFromMove(0, 0, false)
      ui.setStatus(seq === "G" || name === "end" || key.shift ? "Bottom" : "Top")
    } else moveTxnCursor(ui, data, moved - ui.state.managerCursor, key.shift)
    return
  }
}

function handleManagerTxns(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const rows = data?.scopedTransactions() ?? []
  ui.ensureRange(rows)
  if (txnsCommandKeys(ui, key, rows, data)) return
  if (txnsReviewKeys(ui, key, rows, data)) return
  if (txnsTableKeys(ui, key, rows, data)) return
  txnsCursorKeys(ui, key, rows, data)
}

function handleManagerAccounts(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (!data) return
  const stacks = accountStacks(data.state.accounts)
  const rows = stacks.flatMap((stack) => stack.rows)
  const at = rows.findIndex((row) => row.selection === data.state.accountSelection)
  const select = (index: number) => selectAccountRow(ui, data, index)
  // j/k move down the stacks in reading order; h/l go to the first row of
  // the stack beside.
  const moved = listMove(key, Math.max(0, at), rows.length)
  if (moved != null) { select(moved); return }
  const step = name === "h" || name === "left" ? -1 : name === "l" || name === "right" ? 1 : 0
  if (step) {
    const firsts = stacks.map((_, i) => stacks.slice(0, i).reduce((n, stack) => n + stack.rows.length, 0))
    const stack = firsts.findLastIndex((first) => first <= at)
    const next = firsts[stack + step]
    if (next != null && stacks[stack + step]!.rows.length) select(next)
    return
  }
  if (name === "return" || name === "enter") { ui.setState({ focusedSection: "mgr.transactions" }); return }
  const accountId = rows[at]?.accountId
  if ((name === "d" || name === "delete") && accountId != null) { ui.setState({ accountAction: { cursor: 0, id: accountId } }); ui.setStatus("Account data · enter twice to clear or remove · esc cancel"); return }
}

function handleManagerMerchants(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name, sequence: seq } = key
  if (!data) return
  if (savedFilterKeys(ui, data, key)) return
  // u undoes the last change (dataStore.undo); esc clears, below.
  if (name === "u" && data) { runUndo(ui, data); return }

  // The same filtered, scoped rows as the table, summarised per merchant.
  const groups = sortMerchantGroups(groupByMerchant(data.scopedTransactions()), ui.state.merchantSort, ui.state.merchantReverse)
  const group = groups[ui.state.merchantCursor]
  const moveTo = (i: number) => ui.setState({ merchantCursor: Math.max(0, Math.min(groups.length - 1, i)) })
  if (name === "a" && !key.shift) { stepAccount(ui, data); ui.setState({ merchantCursor: 0 }); return }
  if (name === "m") { toTransactions(ui); ui.setStatus("Transactions"); return }
  const moved = listMove(key, ui.state.merchantCursor, groups.length, ui.state.managerVisible)
  if (moved != null) { moveTo(moved); return }
  if (name === "s" && !key.shift) {
    const next = MERCHANT_SORTS[(MERCHANT_SORTS.indexOf(ui.state.merchantSort) + 1) % MERCHANT_SORTS.length]!
    ui.setState({ merchantSort: next, merchantReverse: false, merchantCursor: 0 })
    ui.setStatus(`Merchants by ${next}`)
    return
  }
  if ((name === "s" && key.shift) || name === "S") { ui.setState({ merchantReverse: !ui.state.merchantReverse, merchantCursor: 0 }); return }
  if (isSmartSearchKey(key)) { openSmartSearch(ui, data); return }
  if (name === "/" || seq === "/") { ui.openFilter(data.state.filterQuery); return }
  if ((name === "return" || name === "enter") && group) {
    // Drill in: narrow the filter to this merchant and show its rows.
    const result = data.commitFilter(merchantFilter(data.state.filterQuery, group.merchant))
    if (!result.ok) { ui.setStatus(result.err, true); return }
    toTransactions(ui)
    ui.jumpManagerCursor(0, data.scopedTransactions().length)
    ui.setStatus(`${group.merchant} · ${count(group.count, "transaction")} · esc to widen`)
    return
  }
  if (name === "c" && group) { openCategoryPicker(ui, group.ids, data); return }
  if (name === "t" && group) { ui.openTagPicker(group.ids); return }
  if (name === "n" && !key.shift && group) { openMerchantNote(ui, data, group.merchant); return }
  if (name === "escape") {
    if (data.state.filterQuery) clearTransactionFilter(ui, data)
    else { toTransactions(ui); ui.setStatus("Transactions") }
    return
  }
}

export const managerScopes = {
  "manager.detail": {
    handle: handleManagerDetail,
    list: false,
    hints: (state) => [{ key: "j/k", desc: "prev/next" }, ...(state?.boughtScrolls ? [{ key: "J/K", desc: "scroll bought" }] : []), { key: "c", desc: "category" }, { key: "t", desc: "tags" }, { key: "n", desc: "notes" }, { key: "N", desc: "merchant note" }, { key: "esc", desc: "close" }],
  },
  "manager.ruleOffers": {
    handle: handleRuleOffers,
    list: false,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "make rule" }, { key: "x", desc: "never" }, { key: "esc", desc: "later" }],
  },
  "manager.acceptPreview": {
    handle: handleManagerAcceptPreview,
    list: false,
    hints: () => [{ key: "enter", desc: "accept" }, { key: "esc", desc: "cancel" }],
  },
  "manager.accountAction": {
    handle: handleManagerAccountAction,
    list: false,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "do (twice)" }, { key: "esc", desc: "cancel" }],
  },
  "manager.txns": {
    handle: handleManagerTxns,
    list: true,
    pane: (state) => (state?.tagReview ? "Tag review" : state?.uncategorisedOnly ? "Review" : "Transactions"),
    hints: (state) => state?.tagReview ? [
      { key: "y", desc: "tag", label: "Tag the candidate", description: "selection or row" },
      { key: "Y", desc: `tag all ≥${ACCEPT_ALL_AT * 100}%`, label: `Tag all ≥${ACCEPT_ALL_AT * 100}%…`, description: "shows them first" },
      { key: "x", desc: "dismiss", label: "Dismiss the candidate", description: "for this tag" },
      { key: "u", desc: "undo", command: "txn:undo" },
      { key: "space", desc: "select" },
      { key: "S-j/k", desc: "range" },
      { key: "T", desc: "other tag", command: "txn:tag-review" },
      { key: "esc", desc: "done" },
      { key: "s", desc: "sort" },
      { key: "enter", desc: "detail" },
    ] : state?.uncategorisedOnly ? [
      { key: "y", desc: "accept", label: "Accept the suggestion", description: "selection or row" },
      { key: "Y", desc: `accept all ≥${ACCEPT_ALL_AT * 100}%`, label: `Accept all ≥${ACCEPT_ALL_AT * 100}%…`, description: "shows them first" },
      { key: "x", desc: "dismiss", label: "Dismiss the suggestion", description: "for good" },
      { key: "u", desc: "undo", command: "txn:undo" },
      { key: "c", desc: "choose", label: "Choose a category…" },
      { key: "N", desc: "merchant note", label: "Note on the merchant…", description: "what you buy there" },
      ...(state?.ruleOfferCount ? [{ key: "R", desc: `rules (${state.ruleOfferCount})`, command: "rules:offers" }] : []),
      // The review actions first: the footer shows the first eight
      // (footerLine), and cuts at the end on narrow screens.
      { key: "space", desc: "select" },
      { key: "esc", desc: "all rows" },
      { key: "S-j/k", desc: "range" },
      { key: "i", desc: "all rows" },
      { key: "s", desc: "sort" },
      { key: "?", desc: "smart search" },
      { key: "/", desc: "filter" },
      { key: "enter", desc: "detail" },
      { key: "m", desc: "merchants" },
      { key: "v", desc: "jump" },
    ] : [
      // The first eight show in the footer (footerLine); the rest are in
      // the palette (ctrl+k).
      { key: "j/k", desc: "move" },
      { key: "c", desc: "category", label: "Categorise…", description: "selection or row" },
      { key: "t", desc: "tag", label: "Tag…", description: "selection or row" },
      { key: "space", desc: "select", label: "Select the row" },
      { key: "/", desc: "filter", command: "txn:filter" },
      { key: "?", desc: "smart search", command: "txn:smart-search" },
      { key: "u", desc: "undo", command: "txn:undo" },
      ...(state?.drillReturn ? [{ key: "esc", desc: "back" }] : [{ key: "esc", desc: "clear" }]),
      ...(state?.ruleOfferCount ? [{ key: "R", desc: `rules (${state.ruleOfferCount})`, command: "rules:offers" }] : []),
      ...(state?.asks ? [{ key: "n", desc: state.askLoose ? "matches only" : "near misses", label: state.askLoose ? "Matches only" : "Show near misses" }] : []),
      { key: "enter", desc: "detail", label: "Open the transaction" },
      { key: ".", desc: "repeat", label: "Repeat the last change", description: "on selection or row" },
      { key: "i", desc: "uncategorised", command: "txn:uncategorised" },
      { key: "T", desc: "tag review", command: "txn:tag-review" },
      { key: "m", desc: "merchants", label: "Group by merchant" },
      { key: "N", desc: "merchant note", label: "Note on the merchant…", description: "what you buy there" },
      { key: "a", desc: "account", label: "Next account" },
      { key: "S-j/k", desc: "range" },
      { key: "s", desc: "sort", label: "Cycle the sort" },
      { key: "S-s", desc: "reverse", label: "Reverse the sort" },
      { key: "ctrl+s", desc: "save filter", command: "txn:save-filter" },
      { key: "ctrl+l", desc: "saved filters", label: "Pick a saved filter…" },
      { key: "g", desc: "top", label: "Go to the top" },
      { key: "G", desc: "bottom", label: "Go to the bottom" },
      { key: "v", desc: "jump" },
    ],
  },
  "manager.accounts": {
    handle: handleManagerAccounts,
    list: true,
    pane: () => "Accounts",
    hints: () => [
      { key: "j/k", desc: "account" },
      { key: "h/l", desc: "bank" },
      { key: "enter", desc: "transactions" },
      { key: "d", desc: "data actions" },
      { key: "v", desc: "jump" },
    ],
  },
  "manager.merchants": {
    handle: handleManagerMerchants,
    list: true,
    pane: () => "Merchants",
    hints: () => [
      { key: "j/k", desc: "move" },
      { key: "enter", desc: "its transactions", label: "Its transactions" },
      { key: "c", desc: "category", label: "Categorise all of it…" },
      { key: "t", desc: "tags", label: "Tag all of it…" },
      { key: "n", desc: "note", label: "Note on the merchant…", description: "what you buy there" },
      { key: "/", desc: "filter", command: "txn:filter" },
      { key: "s", desc: "sort", label: "Cycle the sort" },
      { key: "u", desc: "undo", command: "txn:undo" },
      { key: "esc", desc: "back" },
      { key: "?", desc: "smart search", command: "txn:smart-search" },
      { key: "m", desc: "rows", label: "Back to the rows" },
      { key: "a", desc: "account", label: "Next account" },
      { key: "ctrl+s", desc: "save filter", command: "txn:save-filter" },
      { key: "ctrl+l", desc: "saved filters", label: "Pick a saved filter…" },
    ],
  },
  "manager.detail.notes": {
    handle: handleManagerDetailNotes,
    list: false,
    hints: () => [{ key: "type", desc: "notes" }, { key: "enter", desc: "save" }, { key: "esc", desc: "cancel" }],
  },
} satisfies Partial<Record<ScopeId, ScopeEntry>>

