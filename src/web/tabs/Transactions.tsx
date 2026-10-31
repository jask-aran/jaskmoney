/**
 * Transactions: the TUI's Transactions tab in a browser. The accounts, the
 * search (JQL, `?` smart search, the same notes), the table (every row,
 * drawn only where it shows: a few dozen rows of DOM however many match),
 * review (uncategorised rows with their suggestions), and a row's details.
 * Keys as the TUI's where a browser allows: / ? j k x c y enter esc.
 */
import { For, Show, createEffect, createMemo, createSignal, onCleanup, untrack } from "solid-js"
import "./transactions.css"
import { accountStacks, selectionLabel } from "../../domain/accountTree"
import { askTerms, parseFilter } from "../../domain/filter"
import { JQL, JQL_EXAMPLE, JQL_SUMMARY, type Section } from "../../domain/filterLanguage"
import { ACCEPT_ALL_AT } from "../../domain/questions"
import { formatMoney } from "../../domain/dashboard"
import type { SortColumn, Transaction } from "../../domain/types"
import type { TransactionDetail } from "../../db/client"
import { JEV_SETUP } from "../../ai/judge"
import { Check, ChevronRight, CircleHelp, X, Store as MerchantsIcon, Tags, Wand2, ListChecks } from "lucide-solid"
import { Merchants } from "./transactions/Merchants"
import { TagReview } from "./transactions/TagReview"
import { RuleOffers } from "./transactions/RuleOffers"
import { compact, data, fail, run, say, useKeys } from "../store"
import { catColor } from "../theme"
import { BottomSheet, CategoryLabel, CategoryPicker, HeaderAction, Money, PageHeader, Panel, Popup, longPress } from "../kit"
import { Button, GroupHeading, Input, Item, Menu, Section as MenuSection, TextArea } from "../v2"

/** A desktop row's height, which the list is drawn with. */
const rowHeight = () => 40

/** A phone's list: a day's heading, then its rows (taller: a finger's target, two lines). */
const DAY_HEIGHT = 44
const PHONE_ROW = 68

/** A day's name in a phone's list: Today, Yesterday, else its weekday and date (and year when not this one). */
function dayName(iso: string, today: string): string {
  if (iso === today) return "Today"
  const date = new Date(`${iso}T12:00:00`)
  const yesterday = new Date(`${today}T12:00:00`); yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday"
  return date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short", ...(iso.slice(0, 4) !== today.slice(0, 4) ? { year: "numeric" } : {}) })
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-")
  return y && m && d ? `${d}-${m}-${y.slice(2)}` : iso
}

/** What a row bought, as the TUI's table says it after the description. */
const boughtText = (t: Transaction) => (t.bought ?? []).map((b) => (b.quantity > 1 ? `${b.quantity}× ${b.name}` : b.name)).join(", ")

/** The JQL guide: the same sections the TUI's search help shows. */
function SearchHelp(props: { anchor: DOMRect; onClose: () => void; onTry: (q: string) => void }) {
  const sections = JQL.filter((s) => s.brief)
  const rows = (section: Section) => section.blocks.flatMap((b) => (b.kind === "rows" ? b.rows.filter((r) => r.brief && !r.ruleOnly) : []))
  return (
    <Popup label="How searching works" anchor={props.anchor} width={520} height={560} onClose={props.onClose}>
      <Menu width="lg" height="lg">
        <MenuSection note={JQL_SUMMARY}>
          <Item detail={JQL_EXAMPLE.means} detailData={false} onClick={() => props.onTry(JQL_EXAMPLE.write)}><span class="mono">{JQL_EXAMPLE.write}</span></Item>
        </MenuSection>
        <For each={sections}>{(section) => (
          <MenuSection title={section.aside ? `${section.title} · ${section.aside}` : section.title}>
            <For each={rows(section)}>{(row) => (
              <Item detail={row.means} onClick={() => props.onTry(row.write)}><span class="mono">{row.write}</span></Item>
            )}</For>
          </MenuSection>
        )}</For>
      </Menu>
    </Popup>
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
        <Input ref={(el: HTMLInputElement) => { input = el; props.ref(el) }} class="jm-search-input" value={draft()} spellcheck={false} autocomplete="off"
          placeholder={compact() ? "Search, or ? to ask in words" : "Search: coffee  cat:groceries  amt:<-20  date:2026-10   ·   ?in words"}
          inputMode="search" enterkeyhint="search"
          onInput={(e) => { const v = e.currentTarget.value; setDraft(v); if (!v.trim().startsWith("?")) data.setFilterLive(v) }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { commit(); e.preventDefault() }
            else if (e.key === "Escape") { if (draft()) { setDraft(""); data.clearFilter() } else input.blur(); e.preventDefault() }
            else if (e.key === "ArrowDown") { input.blur(); e.preventDefault() }
          }} />
        <Show when={draft()}><Button variant="ghost" size="sm" onClick={() => { setDraft(""); data.clearFilter(); input.focus() }}>Clear</Button></Show>
        <Show when={!compact()} fallback={<Button variant="ghost" size="icon" aria-label="How searching works" onClick={(e) => setHelp(e.currentTarget.getBoundingClientRect())}><CircleHelp /></Button>}>
          <Button variant="ghost" size="sm" title="How searching works" onClick={(e) => setHelp(e.currentTarget.getBoundingClientRect())}>Help</Button>
        </Show>
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
  { id: "date", label: "Date", class: "jm-tx-date" },
  { id: "description", label: "Description", class: "jm-tx-desc" },
  { id: "account", label: "Account", class: "jm-tx-acct" },
  { id: "category", label: "Category", class: "jm-tx-cat" },
  { id: "amount", label: "Amount", class: "jm-tx-amt" },
]

/** A row's details: everything the core knows of it, its category, tags and notes. */
function Detail(props: { id: number; onClose: () => void; onCategory: (anchor: DOMRect) => void }) {
  const t = () => data.transactions().find((x) => x.id === props.id)
  const [extra, setExtra] = createSignal<TransactionDetail | null>(null)
  const [notes, setNotes] = createSignal("")
  // The drawer may close (or move to another row) before the core answers.
  let open = true
  onCleanup(() => { open = false })
  createEffect(() => {
    const id = props.id
    setExtra(null)
    setNotes(untrack(() => t()?.notes ?? ""))
    void data.transactionDetail(id).then((d) => { if (open && untrack(() => props.id) === id) setExtra(d as TransactionDetail | null) }, () => {})
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
  const head = () => {
    const row = t()
    return row ? (
      <div class="grow jm-detail-head">
        <div class="row"><div class="jm-drawer-title grow">{row.description}</div><Money value={row.amount} tone={row.amount > 0} class="jm-drawer-amount" /></div>
        <div class="small note mono">{row.dateISO}{row.status === "HELD" ? " · pending" : ""} · {row.accountName}</div>
      </div>
    ) : <div class="grow" />
  }
  return (
    <Panel label="Transaction" head={head()} onClose={props.onClose}>
      <Show when={t()} fallback={<div class="jm-empty">This row is gone.</div>}>{(row) => (
        <>
          <section>
            <GroupHeading>Category</GroupHeading>
            <button type="button" class="jm-field-button" onClick={(e) => props.onCategory(e.currentTarget.getBoundingClientRect())}>
              <CategoryLabel name={row().categoryName} color={row().categoryColor} />
              <ChevronRight />
            </button>
            <Show when={suggestion()}>{(s) => {
              const c = () => data.state.categories.find((x) => x.id === s().categoryId)
              return (
                <div class="row small jm-suggestion">
                  <span class="note">Suggested</span>
                  <CategoryLabel name={c()?.name ?? ""} color={c()?.color} suggestion confidence={s().confidence} history={s().source === "history"} />
                  <span class="grow" />
                  <Button variant="secondary" size="sm" onClick={() => void run(data.acceptSuggestions([props.id]))}><Check />Accept</Button>
                </div>
              )
            }}</Show>
          </section>
          <Show when={data.state.tags.length}>
            <section>
              <GroupHeading>Tags</GroupHeading>
              <div class="jm-tags">
                <For each={data.state.tags}>{(tag) => {
                  const on = () => row().tagIds.includes(tag.id)
                  return (
                    <button type="button" class="jm-tag" aria-pressed={on()} onClick={() => toggleTag(tag.id, on())}>
                      <span class="dot" style={{ background: tag.color }} />{tag.name}
                    </button>
                  )
                }}</For>
              </div>
            </section>
          </Show>
          <Show when={row().bought?.length}>
            <section>
              <GroupHeading count={row().bought!.length}>Bought</GroupHeading>
              <div class="jm-bought">
                <For each={row().bought}>{(item) => (
                  <div class="jm-bought-row"><span class="note mono">{item.quantity}×</span><span class="grow">{item.name}</span><Show when={item.price != null}><span class="money">{formatMoney(-Math.abs(item.price!))}</span></Show></div>
                )}</For>
              </div>
            </section>
          </Show>
          <section>
            <GroupHeading>Notes</GroupHeading>
            <TextArea class="jm-notes" value={notes()} placeholder="Your own notes (kept in jaskmoney)" onInput={(e) => setNotes(e.currentTarget.value)} />
            <Show when={notes() !== row().notes}>
              <div class="row jm-notes-save">
                <Button variant="ghost" size="sm" onClick={() => setNotes(row().notes ?? "")}>Discard</Button>
                <Button size="sm" onClick={() => void run(data.updateTransactionNotes(props.id, notes()), () => "Notes saved")}>Save notes</Button>
              </div>
            </Show>
          </section>
          <section>
            <GroupHeading>Details</GroupHeading>
            <div class="lines jm-detail-lines">
              <For each={fields()}>{([k, v]) => (<><span class="k">{k}</span><span class="figure jm-detail-v">{v}</span></>)}</For>
            </div>
          </section>
        </>
      )}</Show>
    </Panel>
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
  /** Select mode: a press chooses a row (the check column shows, as DESIGN's edit mode). */
  const [picking, setPicking] = createSignal(false)
  const [merchants, setMerchants] = createSignal(false)
  const [panel, setPanel] = createSignal<"tags" | "rules" | null>(null)
  /** A phone's account chooser (the sidebar's accounts), from the title pill. */
  const [accounts, setAccounts] = createSignal(false)
  // The Account column only when the rows come from more than one (the TUI's rule).
  const manyAccounts = createMemo(() => { const first = rows()[0]?.accountId; return rows().some((t) => t.accountId !== first) })

  // Only the rows in view (and a margin) are drawn.
  const OVERSCAN = 10
  const first = () => Math.max(0, Math.floor(scrollTop() / rowHeight()) - OVERSCAN)
  const last = () => Math.min(rows().length, Math.ceil((scrollTop() + viewHeight()) / rowHeight()) + OVERSCAN)
  const shown = createMemo(() => rows().slice(first(), last()))

  // The table remounts (Merchants replaces it), so each one is measured as it mounts; a removed one says nothing.
  let observer: ResizeObserver | undefined
  const observe = (element: HTMLDivElement) => {
    scroller = element
    setScrollTop(0)
    observer?.disconnect()
    observer = new ResizeObserver(() => { if (element.isConnected) setViewHeight(element.clientHeight) })
    observer.observe(element)
  }
  onCleanup(() => observer?.disconnect())
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
    const cursorRect = () => scroller.querySelector(`[data-id="${cursor()}"] .jm-tx-cat`)?.getBoundingClientRect() ?? scroller.getBoundingClientRect()
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
      <div class="jm-tx" data-id={t.id} data-cursor={cursor() === t.id ? "" : undefined} data-selected={selected().has(t.id) ? "" : undefined} data-pending={t.status === "HELD" ? "" : undefined}
        onClick={(e) => { if (picking() || e.shiftKey || e.metaKey || e.ctrlKey) toggle(t.id); else { setCursor(t.id); if (detail() != null) setDetail(t.id) } }}
        onDblClick={() => setDetail(t.id)}>
        <Show when={picking()}><span class="jm-tx-check" aria-hidden="true">{selected().has(t.id) ? <Check /> : null}</span></Show>
        <span class="jm-tx-date">{shortDate(t.dateISO)}</span>
        <span class="jm-tx-desc">
          <span class="jm-tx-name">{t.description}</span>
          <Show when={sub()}><span class="jm-tx-sub">{sub()}</span></Show>
        </span>
        <Show when={manyAccounts()}><span class="jm-tx-acct">{t.accountName}</span></Show>
        <span class="jm-tx-cat">
          <button type="button" class="jm-tx-catbtn" title="Choose a category (c)" onClick={(e) => { e.stopPropagation(); setCursor(t.id); openPicker(e.currentTarget.getBoundingClientRect(), selected().has(t.id) ? undefined : t.id) }}>
            <Show when={suggestion() && suggested()} fallback={<CategoryLabel name={review() ? (data.state.suggesting ? "suggesting…" : "no suggestion") : t.categoryName} color={review() ? null : t.categoryColor} />}>
              <CategoryLabel name={suggested()!.name} color={suggested()!.color} suggestion confidence={suggestion()!.confidence} history={suggestion()!.source === "history"} />
            </Show>
          </button>
          <Show when={suggestion()}>
            <Button variant="ghost" size="icon-xs" aria-label="Accept" title="Accept (y)" onClick={(e) => { e.stopPropagation(); accept([t.id]) }}><Check /></Button>
          </Show>
          <Show when={!review() && t.tagNames.length}>
            <span class="jm-tx-tags">
              <For each={t.tagNames}>{(name, i) => <span style={{ color: t.tagColors[i()] }}>{name}</span>}</For>
            </span>
          </Show>
        </span>
        <span class="jm-tx-amt"><Money value={t.amount} tone={t.amount > 0} /><Show when={t.status === "HELD"}><span class="faint" title="Pending">◷</span></Show></span>
      </div>
    )
  }

  /** A phone's list: by day while sorted by date, drawn only where it shows (heights vary, so by offset). */
  type Item = { kind: "day"; key: string; label: string; spent: number } | { kind: "tx"; key: number; t: Transaction }
  const today = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10)
  const items = createMemo<Item[]>(() => {
    const list = rows()
    if (data.state.sortColumn !== "date") return list.map((t) => ({ kind: "tx", key: t.id, t }))
    const out: Item[] = []
    const now = today()
    let day: Extract<Item, { kind: "day" }> | null = null
    for (const t of list) {
      if (!day || day.key !== t.dateISO) { day = { kind: "day", key: t.dateISO, label: dayName(t.dateISO, now), spent: 0 }; out.push(day) }
      if (!t.excluded && t.amount < 0) day.spent += t.amount
      out.push({ kind: "tx", key: t.id, t })
    }
    return out
  })
  const offsets = createMemo(() => {
    const at = [0]
    for (const item of items()) at.push(at[at.length - 1]! + (item.kind === "day" ? DAY_HEIGHT : PHONE_ROW))
    return at
  })
  const firstAt = (y: number) => { const at = offsets(); let lo = 0, hi = at.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (at[mid]! <= y) lo = mid; else hi = mid - 1 } return lo }
  const phoneShown = createMemo(() => {
    const from = Math.max(0, firstAt(scrollTop() - 600)), to = Math.min(items().length, firstAt(scrollTop() + viewHeight() + 600) + 1)
    return { top: offsets()[from]!, items: items().slice(from, to) }
  })

  function PhoneRow(props: { t: Transaction }) {
    const t = props.t
    const suggestion = () => (review() ? data.state.suggestions[t.id] : undefined)
    const suggested = () => { const s = suggestion(); return s ? data.state.categories.find((c) => c.id === s.categoryId) : undefined }
    const press = longPress(() => { setPicking(true); toggle(t.id) })
    return (
      <div class="jm-prow" data-selected={selected().has(t.id) ? "" : undefined} data-pending={t.status === "HELD" ? "" : undefined} {...press}
        onClick={() => { if (picking()) toggle(t.id); else { setCursor(t.id); setDetail(t.id) } }}>
        <Show when={picking()}><span class="jm-prow-check" data-on={selected().has(t.id) ? "" : undefined}><Check /></span></Show>
        <span class="jm-prow-mark" style={{ "--mark": catColor(review() ? suggested()?.color ?? null : t.categoryColor) }}>{(t.description.match(/[A-Za-z0-9]/)?.[0] ?? "·").toUpperCase()}</span>
        <span class="jm-prow-main">
          <span class="jm-prow-name">{t.description}</span>
          <span class="jm-prow-sub">
            <Show when={suggestion() && suggested()} fallback={<CategoryLabel name={review() ? (data.state.suggesting ? "suggesting…" : "no suggestion") : t.categoryName} color={review() ? null : t.categoryColor} />}>
              <CategoryLabel name={suggested()!.name} color={suggested()!.color} suggestion confidence={suggestion()!.confidence} history={suggestion()!.source === "history"} />
            </Show>
          </span>
        </span>
        <span class="jm-prow-end">
          <Money value={t.amount} tone={t.amount > 0} />
          <Show when={t.status === "HELD" || (data.state.sortColumn !== "date")}><span class="jm-prow-when">{t.status === "HELD" ? "pending" : shortDate(t.dateISO)}</span></Show>
        </span>
        <Show when={suggestion() && !picking()}>
          <button type="button" class="jm-prow-accept" aria-label={`Accept ${suggested()?.name ?? "the suggestion"}`} onClick={(e) => { e.stopPropagation(); accept([t.id]) }}><Check /></button>
        </Show>
      </div>
    )
  }

  const phoneList = () => (
    <div class="jm-plist" ref={observe} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      <Show when={rows().length} fallback={<div class="jm-empty">{review() ? "Nothing waiting for a category." : data.state.filterQuery ? "No rows match this search." : "No transactions."}</div>}>
        <div style={{ height: `${offsets()[offsets().length - 1]}px`, position: "relative" }}>
          <div style={{ transform: `translateY(${phoneShown().top}px)` }}>
            <For each={phoneShown().items}>{(item) => item.kind === "day"
              ? <div class="jm-pday"><span>{item.label}</span><Show when={item.spent}><span class="money">{formatMoney(item.spent)}</span></Show></div>
              : <PhoneRow t={item.t} />}</For>
          </div>
        </div>
      </Show>
    </div>
  )

  const offers = createMemo(() => data.allRuleOffers().length)
  return (
    <>
      <PageHeader title="Transactions" place={selectionLabel(data.state.accounts, data.state.accountSelection)} onPill={() => setAccounts(true)}
        actions={<>
          <HeaderAction label={review() ? "All rows" : "Review"} icon={<ListChecks />} pressed={review()} onClick={toggleReview} title="Uncategorised rows and their suggestions" />
          <HeaderAction label="Merchants" icon={<MerchantsIcon />} pressed={merchants()} onClick={() => setMerchants(!merchants())} title="Group these rows by merchant" />
          <HeaderAction label="Tag" icon={<Tags />} onClick={() => setPanel("tags")} title="Find the rows a tag belongs on" />
          <Show when={offers()}><HeaderAction label={`Rules ${offers()}`} icon={<Wand2 />} onClick={() => setPanel("rules")} title="Rules offered from repeated categorising" /></Show>
        </>} />
      <div class="jm-txpage">
        <SearchBar ref={(el) => (search = el)} />
        <Show when={!merchants()}><div class="jm-toolbar">
          <span class="small label">
            {rows().length.toLocaleString("en-AU")} row{rows().length === 1 ? "" : "s"}
            <Show when={!review()}>
              <span class="note"> · spent </span><span class="money figure">{formatMoney(totals().out)}</span>
              <Show when={totals().inn}><span class="note"> · in </span><span class="money good">{formatMoney(totals().inn)}</span></Show>
            </Show>
            <Show when={review()}><span class="note"> · {waiting().length} suggested{data.state.suggesting ? " · suggesting…" : ""}</span></Show>
          </span>
          <span class="grow" />
          <Show when={selected().size && !compact()}>
            <span class="small figure">{selected().size} selected</span>
            <Button variant="secondary" size="sm" onClick={(e) => openPicker(e.currentTarget.getBoundingClientRect())}>Category…</Button>
            <Show when={review()}><Button variant="secondary" size="sm" onClick={() => accept([...selected()])}>Accept</Button></Show>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set<number>())}>Clear</Button>
          </Show>
          <Show when={review() && sure().length && !selected().size}>
            <Button size="sm" onClick={() => accept(sure().map((t) => t.id))}>Accept {sure().length} ≥{ACCEPT_ALL_AT * 100}%</Button>
          </Show>
          <Button variant="ghost" size="sm" aria-pressed={picking()} onClick={() => { setPicking(!picking()); if (picking()) say(compact() ? "Tap rows to select them" : "Select: a press chooses a row") }}>{picking() ? "Done" : "Select"}</Button>
        </div></Show>
        <Show when={!merchants()} fallback={<div class="jm-merchants"><Merchants onShowRows={() => setMerchants(false)} /></div>}>
          <Show when={!compact()} fallback={phoneList()}>
          <div class="jm-table" data-accounts={manyAccounts() ? "" : undefined} data-picking={picking() ? "" : undefined}>
            <div class="jm-thead">
              <Show when={picking()}><span /></Show>
              <For each={COLUMNS.filter((c) => c.id !== "account" || manyAccounts())}>{(col) => (
                <button type="button" class={`jm-th ${col.class}`} aria-current={data.state.sortColumn === col.id ? "true" : undefined} onClick={() => sortBy(col.id)}>
                  {col.id === "category" && review() ? "Suggestion" : col.label}
                  <Show when={data.state.sortColumn === col.id}>{data.state.sortAscending ? " ↑" : " ↓"}</Show>
                </button>
              )}</For>
            </div>
            <div class="jm-tbody" ref={observe} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
              <Show when={rows().length} fallback={<div class="jm-empty">{review() ? "Nothing waiting for a category." : data.state.filterQuery ? "No rows match this search." : "No transactions."}</div>}>
                <div style={{ height: `${rows().length * rowHeight()}px`, position: "relative" }}>
                  <div style={{ transform: `translateY(${first() * rowHeight()}px)` }}>
                    <For each={shown()}>{(t) => <Row t={t} />}</For>
                  </div>
                </div>
              </Show>
            </div>
          </div>
          </Show>
        </Show>
      </div>
      <Show when={compact() && (picking() || selected().size)}>
        <div class="jm-selbar">
          <span class="jm-selbar-count">{selected().size ? `${selected().size} selected` : "Tap rows to select"}</span>
          <Show when={selected().size}>
            <Button variant="secondary" size="sm" onClick={(e) => openPicker(e.currentTarget.getBoundingClientRect())}>Category</Button>
            <Show when={review()}><Button variant="secondary" size="sm" onClick={() => accept([...selected()])}>Accept</Button></Show>
          </Show>
          <Button variant="ghost" size="icon-sm" aria-label="Done selecting" onClick={() => { setPicking(false); setSelected(new Set<number>()) }}><X /></Button>
        </div>
      </Show>
      <Show when={accounts()}>
        <BottomSheet label="Accounts" head={<div class="jm-drawer-title">Accounts</div>} onClose={() => setAccounts(false)}>
          <For each={accountStacks(data.state.accounts)}>{(stack) => (
            <section>
              <GroupHeading>{stack.label}</GroupHeading>
              <div class="jm-choices">
                <For each={stack.rows}>{(row) => (
                  <button type="button" class="jm-choice" aria-current={data.state.accountSelection === row.selection ? "true" : undefined}
                    onClick={() => { data.setAccountSelection(row.selection); setAccounts(false) }}>
                    <span class="grow">{row.label}</span>
                    <Show when={row.balance != null}><span class="money">{formatMoney(row.balance!)}</span></Show>
                    <span class="jm-choice-check">{data.state.accountSelection === row.selection ? <Check /> : null}</span>
                  </button>
                )}</For>
              </div>
            </section>
          )}</For>
        </BottomSheet>
      </Show>
      <Show when={detail()}>{(id) => <Detail id={id()} onClose={() => setDetail(null)} onCategory={(anchor) => setPicker({ ids: [id()], anchor })} />}</Show>
      <Show when={picker()}>{(p) => <CategoryPicker ids={p().ids} anchor={p().anchor} onClose={() => setPicker(null)} onDone={() => setSelected(new Set<number>())} />}</Show>
      <Show when={panel() === "tags"}><TagReview onClose={() => setPanel(null)} /></Show>
      <Show when={panel() === "rules"}><RuleOffers onClose={() => setPanel(null)} /></Show>
    </>
  )
}
