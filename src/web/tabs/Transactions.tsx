/**
 * Transactions: the TUI's Transactions tab in a browser. The accounts, the
 * search (JQL, `?` smart search, the same notes), the table (every row,
 * drawn only where it shows: a few dozen rows of DOM however many match),
 * review (uncategorised rows with their suggestions), and a row's details.
 * Keys as the TUI's where a browser allows: / ? j k x c y enter esc.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount, untrack } from "solid-js"
import "./transactions.css"
import { accountStacks } from "../../domain/accountTree"
import { askTerms, parseFilter } from "../../domain/filter"
import { JQL, JQL_EXAMPLE, JQL_SUMMARY, type Section } from "../../domain/filterLanguage"
import { ACCEPT_ALL_AT } from "../../domain/questions"
import { formatMoney } from "../../domain/dashboard"
import type { SortColumn, Transaction } from "../../domain/types"
import type { TransactionDetail } from "../../db/client"
import { JEV_SETUP } from "../../ai/judge"
import { data, fail, run, say, useKeys } from "../store"
import { CategoryLabel, CategoryPicker, Money, placeBelow } from "../ui"
import { Portal } from "solid-js/web"

const narrowQuery = window.matchMedia("(max-width: 760px)")
const [narrow, setNarrow] = createSignal(narrowQuery.matches)
narrowQuery.addEventListener("change", (e) => setNarrow(e.matches))

/** Row heights the list is drawn with (a phone row has a second line). */
const rowHeight = () => (narrow() ? 54 : 36)

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-")
  return y && m && d ? `${d}-${m}-${y.slice(2)}` : iso
}

/** What a row bought, as the TUI's table says it after the description. */
const boughtText = (t: Transaction) => (t.bought ?? []).map((b) => (b.quantity > 1 ? `${b.quantity}× ${b.name}` : b.name)).join(", ")

/** The accounts pane: each source's accounts, and all of them together. */
function Accounts() {
  const stacks = createMemo(() => accountStacks(data.state.accounts))
  return (
    <div class="accounts">
      <For each={stacks()}>{(stack) => (
        <div class="stack">
          <div class="stack-head"><span class="label small">{stack.label}</span>
            <Show when={stack.net != null}><span class="small note money">net {formatMoney(stack.net!)}</span></Show>
          </div>
          <div class="stack-rows">
            <For each={stack.rows}>{(row) => (
              <button type="button" class="acct" classList={{ on: data.state.accountSelection === row.selection }}
                onClick={() => data.setAccountSelection(row.selection)}>
                <span class="name">{row.label}</span>
                <Show when={row.balance != null}><span class="money">{formatMoney(row.balance!)}</span></Show>
              </button>
            )}</For>
          </div>
        </div>
      )}</For>
    </div>
  )
}

/** The JQL guide: the same sections the TUI's search help shows. */
function SearchHelp(props: { anchor: DOMRect; onClose: () => void; onTry: (q: string) => void }) {
  const sections = JQL.filter((s) => s.brief)
  const rows = (section: Section) => section.blocks.flatMap((b) => (b.kind === "rows" ? b.rows.filter((r) => r.brief && !r.ruleOnly) : []))
  return (
    <Portal>
      <div class="backdrop" onClick={props.onClose} />
      <div class="popover help" style={placeBelow(props.anchor, 520, 560)}>
        <div class="head">
          <span class="small label">{JQL_SUMMARY}</span>
          <button type="button" class="example mono" onClick={() => props.onTry(JQL_EXAMPLE.write)}>{JQL_EXAMPLE.write}<span class="note"> {JQL_EXAMPLE.means}</span></button>
        </div>
        <div class="list">
          <For each={sections}>{(section) => (
            <div class="help-section">
              <div class="group">{section.title}<Show when={section.aside}><span class="note"> · {section.aside}</span></Show></div>
              <For each={rows(section)}>{(row) => (
                <button type="button" class="item help-row" onClick={() => props.onTry(row.write)}>
                  <span class="mono key">{row.write}</span><span class="note small">{row.means}</span>
                </button>
              )}</For>
            </div>
          )}</For>
        </div>
      </div>
    </Portal>
  )
}

/** The search bar: live as you type; enter keeps it; `?` asks for one in words. */
function SearchBar(props: { ref: (el: HTMLInputElement) => void }) {
  let input!: HTMLInputElement
  const [draft, setDraft] = createSignal(untrack(() => data.state.filterQuery))
  const [help, setHelp] = createSignal<DOMRect | null>(null)
  // A filter set elsewhere (an Overview category, a saved filter) shows here.
  createEffect(() => { const q = data.state.filterQuery; if (document.activeElement !== input) setDraft(q) })

  async function ask() {
    if (!askTerms(parseFilter(data.state.filterQuery).node).length) return
    say("Jev judging…")
    try {
      const result = await data.askAbout()
      if (!result) return
      const matched = result.terms.reduce((n, t) => n + t.matched, 0), asked = result.terms.reduce((n, t) => n + t.asked, 0)
      say(`Jev judged ${asked} row${asked === 1 ? "" : "s"} in ${(result.ms / 1000).toFixed(1)}s · ${matched} match${result.failures.length ? ` · ${result.failures[0]}` : ""}`, !!result.failures.length)
    } catch (error) { fail(error) }
  }

  async function smart(text: string) {
    const query = text.trim().slice(1).trim()
    if (!query) { say("Type a search after ?, e.g. ?coffee over $5 last month"); return }
    if (!data.state.jev) { say(`Smart search needs Jev (${JEV_SETUP})`, true); return }
    say(`Writing a filter${data.state.clairic ? " with Jev + Clairic" : " with Jev"}…`)
    const started = Date.now()
    try {
      const descriptions = [...new Set(data.accountScoped().map((t) => t.description))]
      const { expr } = await data.smartSearch(query, descriptions)
      if (draft() !== text) return
      setDraft(expr)
      const { ok, err } = data.commitFilter(expr)
      if (!ok) { say(err, true); return }
      say(`?${query} → ${expr} · ${((Date.now() - started) / 1000).toFixed(1)}s · ${data.scopedTransactions().length} rows`)
      void ask()
    } catch (error) { fail(error) }
  }

  function commit() {
    const text = draft()
    if (text.trim().startsWith("?")) { void smart(text); return }
    const { ok, err } = data.commitFilter(text)
    if (!ok) say(err, true)
    else void ask()
  }

  const note = () => data.state.filterErr ? { text: data.state.filterErr, tone: "error" as const } : data.state.filterNote
  return (
    <div class="search">
      <div class="search-row">
        <span class="search-dot" classList={{ err: !!data.state.filterErr, on: !!data.state.filterExpr }} />
        <input ref={(el) => { input = el; props.ref(el) }} class="field mono grow" value={draft()} spellcheck={false} autocomplete="off"
          placeholder="Search: coffee  cat:groceries  amt:<-20  date:2026-10   ·   ?in words"
          onInput={(e) => { const v = e.currentTarget.value; setDraft(v); if (!v.trim().startsWith("?")) data.setFilterLive(v) }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { commit(); e.preventDefault() }
            else if (e.key === "Escape") { if (draft()) { setDraft(""); data.clearFilter() } else input.blur(); e.preventDefault() }
            else if (e.key === "ArrowDown") { input.blur(); e.preventDefault() }
          }} />
        <Show when={draft()}><button type="button" class="btn ghost small" onClick={() => { setDraft(""); data.clearFilter(); input.focus() }}>Clear</button></Show>
        <button type="button" class="btn ghost small" title="How searching works" onClick={(e) => setHelp(e.currentTarget.getBoundingClientRect())}>Help</button>
      </div>
      <div class="search-note mono" classList={{ error: note()?.tone === "error", warn: note()?.tone === "warn" }}>
        <Show when={data.state.asking} fallback={note()?.text ?? ""}>{(asking) => `Jev judging "${asking().words}": ${asking().judged} of ${asking().total}`}</Show>
      </div>
      <Show when={help()}>{(anchor) => (
        <SearchHelp anchor={anchor()} onClose={() => setHelp(null)} onTry={(q) => { setHelp(null); setDraft(q); data.setFilterLive(q); input.focus() }} />
      )}</Show>
    </div>
  )
}

const COLUMNS: Array<{ id: SortColumn; label: string; class: string }> = [
  { id: "date", label: "Date", class: "c-date" },
  { id: "description", label: "Description", class: "c-desc" },
  { id: "account", label: "Account", class: "c-acct" },
  { id: "category", label: "Category", class: "c-cat" },
  { id: "amount", label: "Amount", class: "c-amt" },
]

/** A row's details: everything the core knows of it, its category, tags and notes. */
function Detail(props: { id: number; onClose: () => void; onCategory: (anchor: DOMRect) => void }) {
  const t = () => data.transactions().find((x) => x.id === props.id)
  const [extra, setExtra] = createSignal<TransactionDetail | null>(null)
  const [notes, setNotes] = createSignal("")
  createEffect(() => {
    const id = props.id
    setExtra(null)
    setNotes(untrack(() => t()?.notes ?? ""))
    void data.transactionDetail(id).then((d) => { if (props.id === id) setExtra(d as TransactionDetail | null) }, () => {})
  })
  const suggestion = () => data.state.suggestions[props.id]
  const fields = () => {
    const row = t(), d = extra()
    if (!row) return []
    const when = row.createdMs ? new Date(row.createdMs).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) : row.dateISO
    return [
      ["When", when],
      ["Account", row.accountName],
      ["Status", row.status === "HELD" ? "pending" : row.status === "SETTLED" ? "settled" : ""],
      ["Type", row.transactionType ?? ""],
      ["Method", [row.cardMethod?.toLowerCase().replaceAll("_", " "), d?.cardSuffix ? `card ··${d.cardSuffix}` : ""].filter(Boolean).join(" · ")],
      ["Message", row.message ?? ""],
      ["Bank text", row.rawText ?? ""],
      ["Foreign", row.foreignAmount ?? ""],
      ["Transfer", d?.transferAccountName ?? ""],
      ["Round up", d?.roundUp ? formatMoney(d.roundUp) : ""],
    ].filter(([, v]) => v)
  }
  const toggleTag = (tagId: number, on: boolean) => {
    void run(data.applyTagPatch([props.id], { [tagId]: on ? "remove" : "add" }, "picker"))
  }
  return (
    <aside class="drawer">
      <Show when={t()} fallback={<div class="empty">This row is gone.</div>}>{(row) => (
        <>
          <header>
            <div class="grow">
              <div class="strong detail-title">{row().description}</div>
              <div class="small note">{row().dateISO}{row().status === "HELD" ? " · pending" : ""}</div>
            </div>
            <Money value={row().amount} tone class="detail-amount" />
            <button type="button" class="btn ghost small" onClick={props.onClose} title="Close (esc)">✕</button>
          </header>
          <div class="body">
            <div>
              <p class="section-title">Category</p>
              <div class="row">
                <button type="button" class="btn grow detail-cat" onClick={(e) => props.onCategory(e.currentTarget.getBoundingClientRect())}>
                  <CategoryLabel name={row().categoryName} color={row().categoryColor} />
                  <span class="note small" style={{ "margin-left": "auto" }}>change</span>
                </button>
              </div>
              <Show when={suggestion()}>{(s) => {
                const c = () => data.state.categories.find((x) => x.id === s().categoryId)
                return (
                  <div class="row small suggestion-line">
                    <span class="note">Suggested</span>
                    <CategoryLabel name={c()?.name ?? ""} color={c()?.color} suggestion confidence={s().confidence} history={s().source === "history"} />
                    <button type="button" class="btn small" onClick={() => void run(data.acceptSuggestions([props.id]))}>Accept</button>
                  </div>
                )
              }}</Show>
            </div>
            <Show when={data.state.tags.length}>
              <div>
                <p class="section-title">Tags</p>
                <div class="row" style={{ "flex-wrap": "wrap" }}>
                  <For each={data.state.tags}>{(tag) => {
                    const on = () => row().tagIds.includes(tag.id)
                    return (
                      <button type="button" class="tagchip" classList={{ on: on() }} style={on() ? { color: tag.color } : undefined} onClick={() => toggleTag(tag.id, on())}>
                        <span class="dot" style={{ background: tag.color }} />{tag.name}
                      </button>
                    )
                  }}</For>
                </div>
              </div>
            </Show>
            <Show when={row().bought?.length}>
              <div>
                <p class="section-title">Bought</p>
                <div class="bought">
                  <For each={row().bought}>{(item) => (
                    <div class="bought-row"><span class="note mono">{item.quantity}×</span><span class="grow">{item.name}</span><Show when={item.price != null}><span class="money">{formatMoney(-Math.abs(item.price!))}</span></Show></div>
                  )}</For>
                </div>
              </div>
            </Show>
            <div>
              <p class="section-title">Notes</p>
              <textarea class="field" value={notes()} placeholder="Your own notes (local to jaskmoney)" onInput={(e) => setNotes(e.currentTarget.value)} />
              <div class="row" style={{ "margin-top": "6px" }}>
                <button type="button" class="btn small" disabled={notes() === row().notes} onClick={() => void run(data.updateTransactionNotes(props.id, notes()), () => "Notes saved")}>Save notes</button>
              </div>
            </div>
            <div class="lines detail-fields">
              <For each={fields()}>{([k, v]) => (<><span class="k small">{k}</span><span class="small figure detail-v">{v}</span></>)}</For>
            </div>
          </div>
        </>
      )}</Show>
    </aside>
  )
}

export function Transactions() {
  let search!: HTMLInputElement
  let scroller!: HTMLDivElement
  const rows = () => data.scopedTransactions()
  const [cursor, setCursor] = createSignal<number | null>(null)
  const [selected, setSelected] = createSignal<ReadonlySet<number>>(new Set())
  const [detail, setDetail] = createSignal<number | null>(null)
  const [picker, setPicker] = createSignal<{ ids: number[]; anchor: DOMRect } | null>(null)
  const [scrollTop, setScrollTop] = createSignal(0)
  const [viewHeight, setViewHeight] = createSignal(600)
  const review = () => data.state.uncategorisedOnly
  // The Account column only when the rows come from more than one (the TUI's rule).
  const manyAccounts = createMemo(() => { const first = rows()[0]?.accountId; return rows().some((t) => t.accountId !== first) })

  // Only the rows in view (and a margin) are drawn.
  const OVERSCAN = 10
  const first = () => Math.max(0, Math.floor(scrollTop() / rowHeight()) - OVERSCAN)
  const last = () => Math.min(rows().length, Math.ceil((scrollTop() + viewHeight()) / rowHeight()) + OVERSCAN)
  const shown = createMemo(() => rows().slice(first(), last()))

  onMount(() => {
    const observer = new ResizeObserver(() => setViewHeight(scroller.clientHeight))
    observer.observe(scroller)
    onCleanup(() => observer.disconnect())
  })
  // A new filter or account starts at the top.
  createEffect(() => { data.state.filterExpr; data.state.accountSelection; data.state.uncategorisedOnly; if (scroller) { scroller.scrollTop = 0; setScrollTop(0) } })
  // Selections are of rows still shown.
  createEffect(() => {
    const ids = new Set(rows().map((t) => t.id))
    const kept = [...untrack(selected)].filter((id) => ids.has(id))
    if (kept.length !== untrack(selected).size) setSelected(new Set(kept))
  })

  const totals = createMemo(() => {
    let out = 0, inn = 0
    for (const t of rows()) { if (t.excluded) continue; if (t.amount < 0) out += t.amount; else inn += t.amount }
    return { out, inn }
  })
  const waiting = createMemo(() => review() ? rows().filter((t) => data.state.suggestions[t.id]) : [])
  const sure = createMemo(() => waiting().filter((t) => data.state.suggestions[t.id]!.confidence >= ACCEPT_ALL_AT))

  const indexOf = (id: number | null) => (id == null ? -1 : rows().findIndex((t) => t.id === id))
  function moveTo(index: number) {
    const list = rows()
    if (!list.length) return
    const i = Math.max(0, Math.min(list.length - 1, index))
    setCursor(list[i]!.id)
    const top = i * rowHeight(), bottom = top + rowHeight()
    if (top < scroller.scrollTop) scroller.scrollTop = top
    else if (bottom > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = bottom - scroller.clientHeight
    if (detail() != null) setDetail(list[i]!.id)
  }
  const toggle = (id: number) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  /** What an action applies to: the selection, else the row under the cursor (or clicked). */
  const targets = (id?: number) => (selected().size ? [...selected()] : id != null ? [id] : cursor() != null ? [cursor()!] : [])
  const openPicker = (anchor: DOMRect, id?: number) => { const ids = targets(id); if (ids.length) setPicker({ ids, anchor }) }
  const accept = (ids: number[]) => {
    const withSuggestion = ids.filter((id) => data.state.suggestions[id])
    if (!withSuggestion.length) { say("No suggestion to accept"); return }
    say(`Accepting ${withSuggestion.length}…`)
    void run(data.acceptSuggestions(withSuggestion)).then(() => setSelected(new Set<number>()))
  }
  function toggleReview() {
    const on = !review()
    data.setUncategorisedOnly(on)
    setSelected(new Set<number>())
    if (!on) { say("Transactions"); return }
    const ids = data.scopedTransactions().map((t) => t.id)
    say(`${ids.length} uncategorised · suggesting…`)
    void run(data.suggestCategories(ids))
  }
  const sortBy = (column: SortColumn) => {
    if (data.state.sortColumn === column) data.toggleSortDirection()
    else data.setState({ sortColumn: column, sortAscending: column === "description" || column === "category" || column === "account" })
  }

  useKeys((e) => {
    if (picker()) return false
    const cursorRect = () => scroller.querySelector(`[data-id="${cursor()}"] .c-cat`)?.getBoundingClientRect() ?? scroller.getBoundingClientRect()
    switch (e.key) {
      case "/": search.focus(); return true
      case "?": search.focus(); if (!search.value.startsWith("?")) { search.value = "?"; search.dispatchEvent(new Event("input", { bubbles: true })) } return true
      case "j": case "ArrowDown": moveTo(indexOf(cursor()) + 1); return true
      case "k": case "ArrowUp": moveTo(Math.max(0, indexOf(cursor()) - 1)); return true
      case "g": moveTo(0); return true
      case "G": moveTo(rows().length - 1); return true
      case "x": case " ": if (cursor() != null) toggle(cursor()!); return true
      case "c": openPicker(cursorRect()); return true
      case "y": if (review()) accept(targets()); return true
      case "Enter": if (cursor() != null) setDetail(cursor()); return true
      case "Escape":
        if (detail() != null) setDetail(null)
        else if (selected().size) setSelected(new Set<number>())
        else if (data.state.filterQuery) data.clearFilter()
        else if (review()) toggleReview()
        return true
    }
    return false
  })

  function Row(props: { t: Transaction }) {
    const t = props.t
    const suggestion = () => (review() ? data.state.suggestions[t.id] : undefined)
    const suggested = () => { const s = suggestion(); return s ? data.state.categories.find((c) => c.id === s.categoryId) : undefined }
    const sub = () => [t.message ? `“${t.message}”` : "", boughtText(t)].filter(Boolean).join(" · ")
    return (
      <div class="tx" data-id={t.id} classList={{ cursor: cursor() === t.id, selected: selected().has(t.id), pending: t.status === "HELD", review: review() }}
        onClick={(e) => { if (e.shiftKey || e.metaKey || e.ctrlKey) toggle(t.id); else { setCursor(t.id); if (detail() != null) setDetail(t.id) } }}
        onDblClick={() => setDetail(t.id)}>
        <label class="c-check" onClick={(e) => e.stopPropagation()}>
          <input type="checkbox" checked={selected().has(t.id)} onChange={() => toggle(t.id)} />
        </label>
        <span class="c-date mono note">{shortDate(t.dateISO)}</span>
        <span class="c-desc">
          <span class="desc-main">{t.description}</span>
          <Show when={sub()}><span class="desc-sub note">{sub()}</span></Show>
        </span>
        <Show when={manyAccounts()}><span class="c-acct note small ellipsis">{t.accountName}</span></Show>
        <span class="c-cat">
          <button type="button" class="cat-btn" title="Choose a category (c)" onClick={(e) => { e.stopPropagation(); setCursor(t.id); openPicker(e.currentTarget.getBoundingClientRect(), selected().has(t.id) ? undefined : t.id) }}>
            <Show when={suggestion() && suggested()} fallback={<CategoryLabel name={review() ? (data.state.suggesting ? "suggesting…" : "no suggestion") : t.categoryName} color={review() ? null : t.categoryColor} />}>
              <CategoryLabel name={suggested()!.name} color={suggested()!.color} suggestion confidence={suggestion()!.confidence} history={suggestion()!.source === "history"} />
            </Show>
          </button>
          <Show when={suggestion()}>
            <button type="button" class="accept" title="Accept (y)" onClick={(e) => { e.stopPropagation(); accept([t.id]) }}>✓</button>
          </Show>
          <Show when={!review() && t.tagNames.length}>
            <span class="tags">
              <For each={t.tagNames}>{(name, i) => <span class="tag" style={{ color: t.tagColors[i()] }}>{name}</span>}</For>
            </span>
          </Show>
        </span>
        <span class="c-amt"><Money value={t.amount} tone={t.amount > 0} /><Show when={t.status === "HELD"}><span class="faint pending-mark" title="Pending">◷</span></Show></span>
      </div>
    )
  }

  return (
    <div class="txpage">
      <Accounts />
      <SearchBar ref={(el) => (search = el)} />
      <div class="toolbar">
        <span class="small label">
          {rows().length.toLocaleString("en-AU")} row{rows().length === 1 ? "" : "s"}
          <Show when={!review()}>
            <span class="note"> · spent </span><span class="money figure">{formatMoney(totals().out)}</span>
            <Show when={totals().inn}><span class="note"> · in </span><span class="money good">{formatMoney(totals().inn)}</span></Show>
          </Show>
          <Show when={review()}><span class="note"> · {waiting().length} suggested{data.state.suggesting ? " · suggesting…" : ""}</span></Show>
        </span>
        <span class="grow" />
        <Show when={selected().size}>
          <span class="small key">{selected().size} selected</span>
          <button type="button" class="btn small" onClick={(e) => openPicker(e.currentTarget.getBoundingClientRect())}>Category…</button>
          <Show when={review()}><button type="button" class="btn small" onClick={() => accept([...selected()])}>Accept</button></Show>
          <button type="button" class="btn ghost small" onClick={() => setSelected(new Set<number>())}>Clear</button>
        </Show>
        <Show when={review() && sure().length && !selected().size}>
          <button type="button" class="btn small primary" onClick={() => accept(sure().map((t) => t.id))}>Accept {sure().length} ≥{ACCEPT_ALL_AT * 100}%</button>
        </Show>
        <button type="button" class="btn small" classList={{ primary: !review() && false }} onClick={toggleReview}>{review() ? "All rows" : "Review uncategorised"}</button>
      </div>
      <div class="table" classList={{ "one-account": !manyAccounts() }}>
        <div class="thead">
          <span class="c-check" />
          <For each={COLUMNS.filter((c) => c.id !== "account" || manyAccounts())}>{(col) => (
            <button type="button" class={`th ${col.class}`} classList={{ on: data.state.sortColumn === col.id }} onClick={() => sortBy(col.id)}>
              {col.id === "category" && review() ? "Suggestion" : col.label}
              <Show when={data.state.sortColumn === col.id}><span class="key">{data.state.sortAscending ? " ▲" : " ▼"}</span></Show>
            </button>
          )}</For>
        </div>
        <div class="tbody" ref={scroller} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
          <Show when={rows().length} fallback={<div class="empty">{review() ? "Nothing waiting for a category." : data.state.filterQuery ? "No rows match this search." : "No transactions."}</div>}>
            <div style={{ height: `${rows().length * rowHeight()}px`, position: "relative" }}>
              <div style={{ transform: `translateY(${first() * rowHeight()}px)` }}>
                <For each={shown()}>{(t) => <Row t={t} />}</For>
              </div>
            </div>
          </Show>
        </div>
      </div>
      <Show when={detail()}>{(id) => <Detail id={id()} onClose={() => setDetail(null)} onCategory={(anchor) => setPicker({ ids: [id()], anchor })} />}</Show>
      <Show when={picker()}>{(p) => <CategoryPicker ids={p().ids} anchor={p().anchor} onClose={() => setPicker(null)} onDone={() => setSelected(new Set<number>())} />}</Show>
    </div>
  )
}
