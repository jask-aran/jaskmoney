import { regionRef } from "../regions"
import { ACCOUNT_ACTIONS, armedFor } from "../../state/armed"
import { ListRow } from "../primitives/ListRow"
import { For, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { muted } from "../primitives/spans"
import { S } from "../primitives/S"
import { TextInput } from "../primitives/TextInput"
import { smartQuestionFor, ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { ink, tone, theme } from "../../theme"
import { askTerms, filterExprString } from "../../domain/filter"
import type { Account } from "../../domain/types"
import { fit, truncate } from "../text"
import { categoryMark } from "../icons"
import { ACCEPT_ALL_AT } from "../../domain/questions"
import { accountStacks, selectedAccounts } from "../../domain/accountTree"
import { AccountsPane, accountsPaneHeight } from "./AccountsPane"
import { TransactionTable, type TableTagCandidate } from "./TransactionTable"
import { MerchantTable } from "./MerchantTable"
import { merchantKey } from "../../domain/history"
import { groupByMerchant, sortMerchantGroups } from "../../domain/merchants"
import { TransactionDetail } from "./TransactionDetail"
import { Modal } from "../primitives/Modal"

/** A merchant's note for the table, or a prompt for one where it would
 * help (domain/suggest notePrompts): "always Groceries? n", "varies? n". */
const noNote = () => null

function merchantNote(merchant: string): { text: string; prompt: boolean } | null {
  const key = merchantKey(merchant)
  const note = data.state.merchantNotes[key]
  if (note) return { text: note, prompt: false }
  const prompt = data.notePrompts().get(key)
  if (!prompt) return null
  if (prompt.kind === "varies") return { text: "varies? n", prompt: true }
  return { text: `always ${data.state.categories.find((c) => c.id === prompt.categoryId)?.name ?? "one"}? n`, prompt: true }
}

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

  // Steady cursor: when the rows reorder by themselves (suggestions or tag
  // candidates landing re-sort a confidence-ordered view, ask: verdicts
  // arriving), the cursor stays on its transaction. A change of view (sort,
  // filter, account, special view) or a cursor move keeps the index rules:
  // `s` still goes to the top. A row that left the view leaves the cursor
  // where it was (the next row comes up), and a range keeps its indices.
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


  // Merchant view: the same rows grouped, with its own cursor kept in view.
  const merchants = () => ui.state.txnView === "merchants"
  // Both tables stay mounted and m flips which shows: a toggle rebuilt the
  // whole table each time (~25 ms each way). Hidden, a table's input holds
  // its last value, so it doesn't re-render while hidden, and showing it
  // again redraws only what changed meanwhile.
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
    // Confidence is the suggestion's, shown in the Category column (a tag
    // candidate's is in the unsorted Tags column: no mark).
    const sorted = data.state.sortColumn === "confidence" ? (data.state.tagReview ? "" : "category") : data.state.sortColumn
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
    return data.nearMissesShown() ? `${c.matches} match, then ${c.near} near (≈)` : c.near ? `${c.matches} match · ${c.near} near (n)` : null
  }

  /** Selected rows the view doesn't show (a filter hides them), as the Go app counts them. */
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
    if (rows().length === 0) return undefined
    if (data.state.uncategorisedOnly) {
      const suggested = rows().filter((r) => data.state.suggestions[r.id]).length
      const confident = rows().filter((r) => (data.state.suggestions[r.id]?.confidence ?? 0) >= ACCEPT_ALL_AT).length
      return `${rows().length} to categorise · ${suggested} suggested, ${confident} ≥${ACCEPT_ALL_AT * 100}%${data.state.suggesting ? " · suggesting…" : ""}${
        selCount() > 0 ? ` · ${selCount()} selected${hiddenSelected() ? `, ${hiddenSelected()} hidden` : ""}` : ""}`
    }
    const start = ui.state.managerTop + 1
    const end = Math.min(ui.state.managerTop + ui.state.managerVisible, rows().length)
    // With a filter: how many the account has in all, and selected rows the
    // filter hides (Go app).
    const total = data.state.filterQuery ? data.accountScoped().length : rows().length
    const hidden = hiddenSelected()
    return `showing ${start}-${end} of ${rows().length}${total !== rows().length ? ` (${total.toLocaleString("en-AU")} in all)` : ""}${
      selCount() > 0 ? ` · ${selCount()} selected${hidden ? `, ${hidden} hidden` : ""}` : ""
    }${(ui.state.range != null) ? " · range" : ""} · sort ${data.state.sortColumn}${
      data.state.sortAscending ? "↑" : "↓"
    }`
  }

  // A memo: the card reads it twice, and a cursor move should build it once.
  // After what it reads: a memo runs as it is made.
  const scrollIndicator = createMemo(() => {
    const text = [asking(), askNote(), rowsIndicator()].filter(Boolean).join(" · ")
    return text || undefined
  })

  // Go-style filter bar: the input stays in the pane; its canonical form is
  // rendered next to the title.
  const filterBar = () => {
    const editing = (ui.state.filterBar != null)
    const raw = editing ? (ui.state.filterBar?.draft ?? "") : data.state.filterQuery
    if (!editing && !raw.trim()) return null
    const err = data.state.filterErr
    const note = data.state.filterNote
    // parse: searched as one phrase; check: works, but a name or field is a guess.
    const flag = note?.tone === "warn" ? "check" : err ? "parse" : "ok"
    const dotColor = flag === "check" ? tone.caution : flag === "parse" ? tone.bad : ink.note
    const dotLabel = flag
    const preview =
      data.filterPreview() ||
      (data.state.filterExpr ? filterExprString(data.state.filterExpr) : raw)
    // The question a smart search turned into this filter, while it still is that filter.
    const question = smartQuestionFor(ui.state, raw)
    // ask: terms make it a search Jev answers row by row, not just a filter.
    // (A ?question being typed hasn't become a filter yet.)
    const jev = !(editing && raw.trimStart().startsWith("?")) && askTerms(data.state.filterExpr).length > 0
    return { editing, raw, err, dotColor, dotLabel, note, preview, question, jev }
  }

  /** The title names the filter: by its question when a smart search wrote it. */
  const filterTitle = () => {
    const fb = filterBar()
    if (fb?.question) return `[?${truncate(fb.question, 47)}]`
    if (!fb?.preview) return undefined
    return `[${truncate(fb.preview, 48)}]`
  }

  const accountAction = () => data.state.accounts.find((account) => account.id === (ui.state.accountAction?.id ?? null))

  /** Accept-all's preview: how many rows go to each suggested category. */
  /** Accept-all's preview: per suggested category, how many rows and which
   * (descriptions, most common first; money in marked), so a wrong pick
   * shows before it is taken. */
  const acceptGroups = createMemo(() => {
    const groups = new Map<number, Map<string, number>>()
    const byId = new Map(data.state.transactions.map((t) => [t.id, t]))
    for (const id of ui.state.acceptPreview ?? []) {
      const s = data.state.suggestions[id], t = byId.get(id)
      if (!s || !t) continue
      const rows = groups.get(s.categoryId) ?? new Map<string, number>()
      // What it bought says more than "Amazon ×6": each such row by its first item.
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
  /** R's offers, while its modal is open. */
  const ruleOffers = createMemo(() => (ui.state.ruleOffers !== null ? data.allRuleOffers() : []))
  const ruleTop = () => Math.max(0, ui.state.ruleOffers!.cursor - RULE_LINES + 1)

  /** Tag-all's preview: the rows it would tag, by description (money in marked). */
  const tagPreview = createMemo(() => {
    const byId = new Map(data.state.transactions.map((t) => [t.id, t]))
    const counts = new Map<string, number>()
    for (const id of ui.state.acceptPreview ?? []) {
      const t = byId.get(id)
      if (!t) continue
      const label = `${t.description.trim()}${t.amount > 0 ? " (in)" : ""}`
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    return [...counts].sort((a, b) => b[1] - a[1]).map(([label, n]) => (n > 1 ? `${label} ×${n}` : label))
  })

  /** A row's candidate in a tag review, for the Tags column. */
  const tagCandidate = (id: number): TableTagCandidate | undefined => {
    const review = data.state.tagReview
    const c = review?.candidates[id]
    if (!review || !c) return undefined
    const tag = review.tagId != null ? data.state.tags.find((t) => t.id === review.tagId) : undefined
    return { name: review.name, color: tag?.color ?? theme.blue, confidence: c.confidence, source: c.source }
  }

  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.canvas}>
      <AccountsPane focused={acctFocused()} width={dims().width} />
      <box ref={regionRef("mgr.transactions", "manager")} width="100%" flexGrow={1}>
      <SectionCard
        title={`Transactions${data.state.tagReview ? ` · tagging ${data.state.tagReview.name}` : data.state.uncategorisedOnly ? " · uncategorised" : ""}${merchants() ? " · by merchant" : ""}`}
        titleSuffix={filterTitle()}
        titleSuffixColor={data.state.filterErr ? tone.bad : tone.scope}
        focused={txFocused()}
        active={txFocused()}
        flexGrow={1}
        bottomSpans={scrollIndicator() ? [muted(scrollIndicator()!)] : []}
      >
        <Show when={filterBar()}>
          {(fb: () => NonNullable<ReturnType<typeof filterBar>>) => (
            <text>
              <S fg={tone.key} bold>
                /
              </S>
              <S fg={ink.figure}>{" "}</S>
              <TextInput field={{ value: fb().raw, caret: (ui.state.filterBar?.caret ?? 0) }} focused={fb().editing} caretColor={tone.key} />
              <S fg={ink.figure}>{"  "}</S>
              <S fg={fb().dotColor}>●</S>
              <S fg={fb().dotColor}> {fb().dotLabel}</S>
              {fb().note ? <S fg={fb().note!.tone === "error" ? tone.bad : fb().note!.tone === "warn" ? tone.caution : ink.note}>{`  ${truncate(fb().note!.text, Math.max(8, dims().width - 4 - 14 - fb().raw.length - (fb().jev ? 22 : 0) - (fb().question ? 6 + fb().question!.length : 0) - (fb().editing ? 0 : 18)))}`}</S> : null}
              {fb().jev ? <S fg={tone.ai}>{"  ◆ ask: judged by Jev"}</S> : null}
              {fb().question ? <S fg={ink.note}>{fb().editing ? `  ↑ ?${fb().question}` : `  from ?${fb().question}`}</S> : null}
              {!fb().editing ? <S fg={ink.note}>{ui.state.drillReturn ? "  (esc back · u clear)" : "  (esc clear)"}</S> : null}
            </text>
          )}
        </Show>
        <box visible={merchants()} flexGrow={1} width="100%" flexDirection="column">
          <MerchantTable
            groups={groups()}
            top={ui.state.merchantTop}
            visible={ui.state.managerVisible}
            cursor={txFocused() && ui.state.filterBar == null ? ui.state.merchantCursor : null}
            width={dims().width - 4}
            sort={ui.state.merchantSort}
            reverse={ui.state.merchantReverse}
            empty={data.state.filterQuery ? "No matches" : "Empty · no transactions loaded"}
            // Hidden, no notes: each reads the whole-history note prompts.
            note={merchants() ? merchantNote : noNote}
          />
        </box>
        <box visible={!merchants()} flexGrow={1} width="100%" flexDirection="column">
        <TransactionTable
          rows={tableRows()}
          top={ui.state.managerTop}
          visible={ui.state.managerVisible}
          cursor={txFocused() && ui.state.filterBar == null ? ui.state.managerCursor : null}
          width={dims().width - 4}
          showAccount={showAccount()}
          showTags
          selectedIds={ui.state.selectedIds}
          highlighted={highlighted()}
          sortMark={sortMark}
          empty={data.state.tagReview ? (data.state.tagReview.asking ? "Asking Jev…" : "Nothing more to tag") : data.state.uncategorisedOnly ? "Nothing to categorise" : data.state.filterQuery ? "No matches" : "Empty · no transactions loaded"}
          suggestions={data.state.uncategorisedOnly ? data.state.suggestions : undefined}
          askScore={data.nearMissesShown() ? data.askScore : undefined}
          nearMiss={(id) => data.nearMissIds().has(id)}
          tagCandidate={data.state.tagReview ? tagCandidate : undefined}
        />
        </box>
      </SectionCard>
      </box>
      <TransactionDetail />
      <Show when={ui.state.acceptPreview && data.state.tagReview}>
        <Modal title={`Tag ${data.state.tagReview?.name ?? ""}`} subtitle={`${ui.state.acceptPreview?.length ?? 0} at ${ACCEPT_ALL_AT * 100}% or more`} width={72} hints="enter tag · esc cancel">
          <For each={tagPreview().slice(0, ACCEPT_LINES * 2)}>{(line) => <text wrapMode="none" fg={ink.figure}>{`  ${fit(line, 66)}`}</text>}</For>
          <Show when={tagPreview().length > ACCEPT_LINES * 2}>
            <text fg={ink.note}>{`  and ${tagPreview().length - ACCEPT_LINES * 2} more`}</text>
          </Show>
          <text> </text>
          <text fg={ink.note}>Up rows are tagged in Up too.</text>
        </Modal>
      </Show>
      <Show when={!data.state.tagReview && ui.state.acceptPreview}>
        {(ids: () => number[]) => (
          <Modal title="Accept suggestions" subtitle={`${ids().length} at ${ACCEPT_ALL_AT * 100}% or more`} width={72} hints="enter accept · esc cancel">
            <For each={acceptGroups().slice(0, ACCEPT_LINES)}>{(g) => (
              <>
                <text wrapMode="none">
                  <S fg={g.category?.color ?? ink.figure}>{`${categoryMark(g.category?.id ?? null)} `}</S>
                  <S fg={ink.figure}>{fit(g.category?.name ?? "?", 52)}</S>
                  <S fg={ink.note}>{String(g.n).padStart(6)}</S>
                </text>
                <text wrapMode="none" fg={ink.note}>{`  ${fit(g.rows, 64)}`}</text>
              </>
            )}</For>
            <Show when={acceptGroups().length > ACCEPT_LINES}>
              <text fg={ink.note}>{`and ${acceptGroups().length - ACCEPT_LINES} more ${acceptGroups().length - ACCEPT_LINES === 1 ? "category" : "categories"}`}</text>
            </Show>
            <text> </text>
            <text fg={ink.note}>Up rows are categorised in Up too.</text>
          </Modal>
        )}
      </Show>
      <Show when={ui.state.ruleOffers !== null}>
        <Modal title="Make rules" subtitle={data.state.writingRules ? "asking the AI…" : `${ruleOffers().length} offered`} width={76} hints="j/k move · enter choose · x never offer · esc later">
          <text fg={ink.note}>New rows these find get the category on sync, without review.</text>
          <text> </text>
          <For each={ruleOffers().slice(ruleTop(), ruleTop() + RULE_LINES)}>{(offer, i) => {
            const category = () => data.state.categories.find((c) => c.id === offer.categoryId)
            const tag = () => data.state.tags.find((t) => t.id === offer.tagId)
            const at = () => ruleTop() + i() === ui.state.ruleOffers!.cursor
            return (
              <>
                <ListRow cursor={at()} bg={theme.mantle} spans={[
                  { text: ` ${fit(offer.description, 34)}`, fg: ink.figure },
                  { text: " → ", fg: ink.rule },
                  { text: offer.tagId != null ? fit(`+${tag()?.name ?? "?"}`, 32) : `${categoryMark(offer.categoryId)} ${fit(category()?.name ?? "?", 30)}`, fg: tag()?.color ?? category()?.color ?? ink.figure },
                ]} />
                <text wrapMode="none" fg={ink.note}>{fit(`    ${offer.source === "ai" ? `AI · ${offer.expr}` : `you chose it ${offer.times}×`} · ${offer.agreeing} of ${offer.categorised} found are there${offer.waiting.length ? ` · ${offer.waiting.length} waiting` : ""}`, 72)}</text>
                <Show when={offer.why}>
                  <text wrapMode="none" fg={ink.note}>{fit(`    ${offer.why}`, 72)}</text>
                </Show>
                <Show when={offer.others.length}>
                  <text wrapMode="none" fg={tone.caution}>{fit(`    also finds ${offer.others.join(", ")}`, 72)}</text>
                </Show>
              </>
            )
          }}</For>
          <Show when={!!data.state.llm && ruleOffers().length >= ruleTop() && ruleOffers().length < ruleTop() + RULE_LINES}>
            <ListRow cursor={ui.state.ruleOffers!.cursor === ruleOffers().length} bg={theme.mantle} spans={[{ text: ` ${data.state.writingRules ? `Asking ${data.state.llm}…` : "Ask the AI for more rules"}`, fg: tone.ai }]} />
          </Show>
          <Show when={ruleOffers().length + (!!data.state.llm ? 1 : 0) > RULE_LINES}>
            <text fg={ink.note}>{`  ${ruleTop() + 1}–${Math.min(ruleTop() + RULE_LINES, ruleOffers().length + (!!data.state.llm ? 1 : 0))} of ${ruleOffers().length + (!!data.state.llm ? 1 : 0)}`}</text>
          </Show>
        </Modal>
      </Show>
      <Show when={accountAction()}>
        {(account: () => Account) => (
          <Modal title="Account data" subtitle={account().name} tone="warning" width={68} hints="j/k move · enter, enter again · esc cancel">
            <For each={ACCOUNT_ACTIONS}>{(kind, i) => (
              <ListRow cursor={(ui.state.accountAction?.cursor ?? 0) === i()} bg={theme.mantle} armed={armedFor(ui.state.armed, kind, account().id)} spans={[
                { text: kind === "clearAccount" ? "Clear this account’s transactions" : "Remove this account and its transactions", fg: kind === "clearAccount" ? ink.figure : tone.bad },
              ]} />
            )}</For>
          </Modal>
        )}
      </Show>
    </box>
  )
}
