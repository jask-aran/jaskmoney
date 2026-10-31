/**
 * The web app's shared pieces: a card (the TUI's pane), money, chips, a
 * category label, and the one category picker every row opens.
 */
import { For, Show, createMemo, createSignal, onMount, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { formatMoney } from "../domain/dashboard"
import { categoryPickerRows, pickerSuggestions, type PickerRow } from "../domain/categoryOptions"
import { ACCEPT_ALL_AT } from "../domain/questions"
import { isUncategorisedColor } from "../theme"
import { catColor, provisional } from "./theme"
import { data, run, say } from "./store"

export function Card(props: { title: JSX.Element; aside?: JSX.Element; footer?: JSX.Element; class?: string; style?: JSX.CSSProperties; children: JSX.Element }) {
  return (
    <section class={`card ${props.class ?? ""}`} style={props.style}>
      <header>
        <h2>{props.title}</h2>
        <Show when={props.aside}><div class="aside">{props.aside}</div></Show>
      </header>
      <div class="body">{props.children}</div>
      <Show when={props.footer}><footer>{props.footer}</footer></Show>
    </section>
  )
}

/** An amount: income in good, spending as a plain figure (`tone` colours both). */
export function Money(props: { value: number; tone?: boolean; class?: string }) {
  return <span class={`money ${props.tone ? (props.value > 0 ? "good" : props.value < 0 ? "bad" : "faint") : ""} ${props.class ?? ""}`}>{formatMoney(props.value)}</span>
}

export function Chips<T extends string | number>(props: { options: Array<{ value: T; label: JSX.Element; title?: string }>; value: T; onChange: (value: T) => void; class?: string }) {
  return (
    <div class={`chips ${props.class ?? ""}`} role="tablist">
      <For each={props.options}>{(option) => (
        <button type="button" role="tab" class="chip" classList={{ on: option.value === props.value }} title={option.title} onClick={() => props.onChange(option.value)}>{option.label}</button>
      )}</For>
    </div>
  )
}

/** "How sure" colours, as the TUI's: sure enough to accept all, worth a look, a guess. */
export const confidenceClass = (confidence: number) => (confidence >= ACCEPT_ALL_AT ? "good" : confidence >= 0.5 ? "caution" : "note")

export function CategoryLabel(props: { name: string; color: string | null | undefined; suggestion?: boolean; confidence?: number; history?: boolean }) {
  const muted = () => !props.name || props.name === "Uncategorised" || isUncategorisedColor(props.color)
  return (
    <span class="cat" classList={{ muted: muted() && !props.suggestion, provisional: !!props.suggestion }}>
      <Show when={props.confidence != null}>
        <span class={`conf ${confidenceClass(props.confidence!)}`}>{props.history ? "↺" : ""}{Math.round(props.confidence! * 100)}%</span>
      </Show>
      <span class="dot" style={{ background: props.suggestion ? provisional(props.color) : catColor(props.color) }} />
      <span class="name" style={props.suggestion ? { color: provisional(props.color) } : undefined}>{props.name || "Uncategorised"}</span>
    </span>
  )
}

/** Where a popover goes: under the anchor, kept on screen. */
export function placeBelow(anchor: DOMRect, width = 340, height = 460): JSX.CSSProperties {
  const left = Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))
  const below = anchor.bottom + 6
  const top = below + Math.min(height, window.innerHeight - 24) > window.innerHeight ? Math.max(12, anchor.top - Math.min(height, window.innerHeight - 24) - 6) : below
  return { left: `${left}px`, top: `${top}px` }
}

/**
 * The category picker: type to narrow (a category or its group), arrows
 * and enter, or a click. For one row, its suggestions first with how sure;
 * for several, what they were most often suggested.
 */
export function CategoryPicker(props: { ids: number[]; anchor: DOMRect; onClose: () => void; onDone?: () => void }) {
  const [query, setQuery] = createSignal("")
  const [cursor, setCursor] = createSignal(0)
  let input!: HTMLInputElement
  let list!: HTMLDivElement
  const rows = createMemo<PickerRow[]>(() => categoryPickerRows(data.state.categories, query(), true, pickerSuggestions(props.ids, data.state.suggestions)))
  const picks = createMemo(() => rows().filter((r): r is Extract<PickerRow, { kind: "category" }> => r.kind === "category"))
  onMount(() => input.focus())
  const choose = (categoryId: number) => {
    const category = data.state.categories.find((c) => c.id === categoryId)
    props.onClose()
    say(`Categorising ${props.ids.length === 1 ? "1 row" : `${props.ids.length} rows`} as ${category?.name ?? "…"}…`)
    void run(data.categorizeTransactions(props.ids, categoryId)).then(() => props.onDone?.())
  }
  const move = (delta: number) => {
    const n = picks().length
    if (!n) return
    setCursor((c) => (c + delta + n) % n)
    list.querySelector(`[data-index="${cursor()}"]`)?.scrollIntoView({ block: "nearest" })
  }
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "ArrowDown") { move(1); event.preventDefault() }
    else if (event.key === "ArrowUp") { move(-1); event.preventDefault() }
    else if (event.key === "Enter") { const pick = picks()[cursor()]; if (pick) choose(pick.category.id); event.preventDefault() }
    else if (event.key === "Escape") { props.onClose(); event.preventDefault() }
  }
  return (
    <Portal>
      <div class="backdrop" onClick={props.onClose} />
      <div class="popover" style={placeBelow(props.anchor)} onKeyDown={onKey}>
        <div class="head">
          <span class="small note">Category for {props.ids.length === 1 ? "this row" : `${props.ids.length} rows`}</span>
          <input ref={input} class="field" placeholder="Type to find a category" value={query()} onInput={(e) => { setQuery(e.currentTarget.value); setCursor(0) }} />
        </div>
        <div class="list" ref={list}>
          <For each={rows()} fallback={<div class="empty small">No category matches</div>}>{(row) => (
            row.kind === "heading"
              ? <div class="group">{row.label}</div>
              : (
                <button type="button" class="item" data-index={row.index} classList={{ on: row.index === cursor() }} onMouseEnter={() => setCursor(row.index)} onClick={() => choose(row.category.id)}>
                  <CategoryLabel name={row.category.name} color={row.category.color} />
                  <Show when={row.confidence != null}><span class={`aside conf ${confidenceClass(row.confidence!)}`}>{Math.round(row.confidence! * 100)}%</span></Show>
                </button>
              )
          )}</For>
        </div>
      </div>
    </Portal>
  )
}

/** Empty, loading or unreachable: one quiet line in the middle. */
export function Empty(props: { children: JSX.Element }) {
  return <div class="empty">{props.children}</div>
}
