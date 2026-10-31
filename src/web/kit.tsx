/**
 * jaskmoney's pieces, built from components v2 (./v2, Conduit's library in jaskmoney's material): a page and its
 * header, a section (a heading and its rows, no box), money, a category label, chips, and the one category picker
 * every row opens. Pages use these and the v2 families; no page styles a control of its own.
 */
import { For, Show, createMemo, createSignal, onCleanup, onMount, type JSX } from "solid-js"
import { Portal } from "solid-js/web"
import { ChevronDown, X } from "lucide-solid"
import "./v2"
import "./kit.css"
import { formatMoney } from "../domain/dashboard"
import { categoryPickerRows, pickerSuggestions, type PickerRow } from "../domain/categoryOptions"
import { ACCEPT_ALL_AT } from "../domain/questions"
import { isUncategorisedColor } from "../theme"
import { catColor, provisional } from "./theme"
import { compact, data, run, say } from "./store"
import { Button, Frost, Group, GroupHeading, Header, HeaderButton, HeaderCrumb, HeaderPill, Item, Menu, SearchSection, Section as MenuSection, Segmented } from "./v2"

/** A tab's top line: its name, what it's looking at beside it, quiet actions at the right. On a phone the name is a
 *  pill (onPill: a tap on it chooses what the tab looks at, as an account) and the actions a pill of icons. */
export function PageHeader(props: { title: string; place?: string; after?: JSX.Element; actions?: JSX.Element; onPill?: () => void }) {
  return (
    <Header pill={compact() ? <HeaderPill label={props.onPill && props.place ? props.place : props.title} opens={!!props.onPill} onClick={() => props.onPill?.()} icon={props.onPill ? <ChevronDown /> : undefined} /> : undefined}
      after={props.after} actions={props.actions}>
      <HeaderCrumb place={props.place} title={props.title} />
    </Header>
  )
}

/** One of a tab's header actions: its icon and name on a desktop, its icon alone on a phone (the name its label). */
export function HeaderAction(props: { label: string; icon: JSX.Element; pressed?: boolean; title?: string; onClick: () => void }) {
  return (
    <Show when={!compact()} fallback={<HeaderButton label={props.label} icon={props.icon} aria-pressed={props.pressed} onClick={() => props.onClick()} />}>
      <Button variant="ghost" size="sm" aria-pressed={props.pressed} title={props.title} onClick={() => props.onClick()}>{props.icon}{props.label}</Button>
    </Show>
  )
}

/** A tab's scrolling body, in the page gutter. */
export function Page(props: { class?: string; children: JSX.Element }) {
  return <div class={`jm-page ${props.class ?? ""}`}>{props.children}</div>
}

/** A section: its label (the library's mono caps), an aside at the right, then its rows. No box: heading and space. */
export function Section(props: { title: string; count?: number | string | null; aside?: JSX.Element; class?: string; children: JSX.Element }) {
  return (
    <div class={`jm-section ${props.class ?? ""}`}>
      <Group id={props.title} heading={<GroupHeading count={props.count}>{props.title}</GroupHeading>} actions={props.aside}>{props.children}</Group>
    </div>
  )
}

/** The old name, for pages not yet on Section: a heading and its rows. */
export function Card(props: { title: JSX.Element; aside?: JSX.Element; footer?: JSX.Element; class?: string; style?: JSX.CSSProperties; children: JSX.Element }) {
  return (
    <div class={`jm-section ${props.class ?? ""}`} style={props.style}>
      <Group id={typeof props.title === "string" ? props.title : "section"} heading={<GroupHeading>{props.title}</GroupHeading>} actions={props.aside}>
        {props.children}
        <Show when={props.footer}><div class="jm-section-foot">{props.footer}</div></Show>
      </Group>
    </div>
  )
}

/** An amount in the data face: income in good when `tone`, spending as a plain figure. */
export function Money(props: { value: number; tone?: boolean; class?: string }) {
  return <span class={`money ${props.tone ? (props.value > 0 ? "good" : props.value < 0 ? "bad" : "faint") : ""} ${props.class ?? ""}`}>{formatMoney(props.value)}</span>
}

/** Choices side by side: the library's Segmented (values of any kind, by their place). */
export function Chips<T extends string | number>(props: { options: Array<{ value: T; label: JSX.Element; title?: string }>; value: T; onChange: (value: T) => void; label?: string; class?: string }) {
  const options = createMemo(() => props.options.map((o, i) => ({ value: String(i), label: typeof o.label === "string" ? o.label : String(o.value), title: o.title })))
  const at = () => String(Math.max(0, props.options.findIndex((o) => o.value === props.value)))
  return (
    <span class={props.class}>
      <Segmented size="sm" label={props.label ?? "Choose"} value={at()} options={options()} onChange={(i) => props.onChange(props.options[Number(i)]!.value)} />
    </span>
  )
}

/** "How sure" colours, as the TUI's: sure enough to accept all, worth a look, a guess. */
export const confidenceClass = (confidence: number) => (confidence >= ACCEPT_ALL_AT ? "good" : confidence >= 0.5 ? "caution" : "note")

/** A category: its dot and name; a suggestion's is faded and italic, its confidence first. */
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
  const room = Math.min(height, window.innerHeight - 24)
  const top = below + room > window.innerHeight ? Math.max(12, anchor.top - room - 6) : below
  return { left: `${left}px`, top: `${top}px` }
}

/** A floating surface placed under an anchor, closed by a press outside or esc. */
export function Floating(props: { anchor: DOMRect; width?: number; height?: number; onClose: () => void; children: JSX.Element }) {
  return (
    <Portal>
      <div class="jm-outside" onPointerDown={() => props.onClose()} />
      <div class="jm-floating" style={placeBelow(props.anchor, props.width, props.height)} onKeyDown={(e) => { if (e.key === "Escape") { props.onClose(); e.preventDefault() } }}>
        {props.children}
      </div>
    </Portal>
  )
}

/**
 * The category picker: type to narrow (a category or its group), arrows and enter, or a press. For one row, its
 * suggestions first with how sure; for several, what they were most often suggested.
 */
export function CategoryPicker(props: { ids: number[]; anchor: DOMRect; onClose: () => void; onDone?: () => void }) {
  // Fixed while it's open; read once, as closing it ends the props.
  const ids = props.ids
  const [query, setQuery] = createSignal("")
  const [cursor, setCursor] = createSignal(0)
  let field!: HTMLInputElement
  let list!: HTMLDivElement
  const rows = createMemo<PickerRow[]>(() => categoryPickerRows(data.state.categories, query(), true, pickerSuggestions(ids, data.state.suggestions)))
  const picks = createMemo(() => rows().filter((r): r is Extract<PickerRow, { kind: "category" }> => r.kind === "category"))
  onMount(() => { if (!compact()) field.focus() })
  const choose = (categoryId: number) => {
    const category = data.state.categories.find((c) => c.id === categoryId)
    const { onClose, onDone } = props
    onClose()
    say(`Categorising ${ids.length === 1 ? "1 row" : `${ids.length} rows`} as ${category?.name ?? "…"}…`)
    void run(data.categorizeTransactions(ids, categoryId)).then(() => onDone?.())
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
  }
  const menu = () => (
      <Menu width="sm" onKeyDown={onKey}>
        <SearchSection placeholder={ids.length === 1 ? "Category for this row" : `Category for ${ids.length} rows`} value={query()}
          onInput={(v) => { setQuery(v); setCursor(0) }} field={{ ref: (el: HTMLInputElement) => (field = el) }} />
        <MenuSection scroll ref={list}>
          <For each={rows()} fallback={<p class="jm-empty-line">No category matches</p>}>{(row) => (
            row.kind === "heading"
              ? <div class="jm-picker-group ui-title">{row.label}</div>
              : (
                <Item data-index={row.index} active={row.index === cursor()} onCursor={() => setCursor(row.index)} onClick={() => choose(row.category.id)}
                  meta={row.confidence != null ? <span class={`conf ${confidenceClass(row.confidence)}`}>{Math.round(row.confidence * 100)}%</span> : undefined}>
                  <CategoryLabel name={row.category.name} color={row.category.color} />
                </Item>
              )
          )}</For>
        </MenuSection>
      </Menu>
  )
  return (
    <Show when={!compact()} fallback={<BottomSheet label="Category" full onClose={props.onClose}><div class="jm-sheet-menu">{menu()}</div></BottomSheet>}>
      <Floating anchor={props.anchor} onClose={props.onClose}>{menu()}</Floating>
    </Show>
  )
}

/** A menu (Menu) for a desktop's popover, or the same list in a phone's sheet: `Floating` or `BottomSheet`. */
export function Popup(props: { label: string; anchor: DOMRect; width?: number; height?: number; onClose: () => void; children: JSX.Element }) {
  return (
    <Show when={!compact()} fallback={<BottomSheet label={props.label} full onClose={props.onClose}><div class="jm-sheet-menu">{props.children}</div></BottomSheet>}>
      <Floating anchor={props.anchor} width={props.width} height={props.height} onClose={props.onClose}>{props.children}</Floating>
    </Show>
  )
}

/** Empty, loading or unreachable: one quiet line. */
export function Empty(props: { children: JSX.Element }) {
  return <div class="jm-empty">{props.children}</div>
}

/**
 * A bottom sheet (a phone's panel): it rises from the bottom edge over a dimmed page, a grab handle at its top.
 * A drag down on the handle or the head closes it, as does a tap on the dim or esc.
 */
export function BottomSheet(props: { label: string; head?: JSX.Element; onClose: () => void; children: JSX.Element; full?: boolean }) {
  const [drag, setDrag] = createSignal(0)
  let start: number | null = null
  // A press on a control in the head (Cancel, Save) is that control's, not a drag.
  const down = (event: PointerEvent) => {
    if ((event.target as Element).closest("button, input, textarea, select, a, [role=button]")) return
    start = event.clientY; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  }
  const move = (event: PointerEvent) => { if (start != null) setDrag(Math.max(0, event.clientY - start)) }
  const up = () => { if (start == null) return; start = null; if (drag() > 90) props.onClose(); else setDrag(0) }
  const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { props.onClose(); event.preventDefault() } }
  onMount(() => window.addEventListener("keydown", onKey))
  onCleanup(() => window.removeEventListener("keydown", onKey))
  return (
    <Portal>
      <div class="jm-sheet-dim" onClick={() => props.onClose()} />
      <div class="jm-bottom-sheet" role="dialog" aria-modal="true" aria-label={props.label} data-full={props.full ? "" : undefined}
        style={drag() ? { transform: `translateY(${drag()}px)`, transition: "none" } : undefined}>
        <div class="jm-sheet-grab" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <span class="jm-sheet-handle" />
          <Show when={props.head}><div class="jm-sheet-head">{props.head}</div></Show>
        </div>
        <div class="jm-sheet-body">{props.children}</div>
      </div>
    </Portal>
  )
}

/**
 * A panel about one thing (a row's details, tag review, rule offers): a frost panel at the page's right on a
 * desktop, a bottom sheet on a phone. head: its title line; the body scrolls under it.
 */
export function Panel(props: { label: string; head: JSX.Element; onClose: () => void; children: JSX.Element }) {
  return (
    <Show when={!compact()} fallback={<BottomSheet label={props.label} head={props.head} onClose={props.onClose}>{props.children}</BottomSheet>}>
      <Frost as="div" lift="raised" class="jm-drawer" role="dialog" aria-label={props.label}>
        <header class="jm-drawer-head">{props.head}<Button variant="ghost" size="icon-sm" aria-label="Close" title="Close (esc)" onClick={() => props.onClose()}><X /></Button></header>
        <div class="jm-drawer-body">{props.children}</div>
      </Frost>
    </Show>
  )
}

/** A phone's tabs: a frost bar along the bottom edge, each tab its icon over its name. */
export function TabBar<T extends string>(props: { tabs: Array<{ id: T; label: string; icon: JSX.Element; badge?: number | null }>; current: T; onChoose: (id: T) => void }) {
  return (
    <Frost as="div" lift="raised" class="jm-tabbar" role="tablist">
      <For each={props.tabs}>{(t) => (
        <button type="button" role="tab" class="jm-tabbar-tab" aria-selected={props.current === t.id} onClick={() => props.onChoose(t.id)}>
          <span class="jm-tabbar-icon">{t.icon}<Show when={t.badge}><span class="jm-tabbar-badge">{t.badge! > 99 ? "99+" : t.badge}</span></Show></span>
          <span class="jm-tabbar-label">{t.label}</span>
        </button>
      )}</For>
    </Frost>
  )
}

/** A long press (a phone's right click): calls `onLong` after 450ms held still; a move or lift before cancels it. */
export function longPress(onLong: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let at: { x: number; y: number } | null = null
  const cancel = () => { clearTimeout(timer); at = null }
  return {
    onPointerDown: (event: PointerEvent) => { if (event.pointerType !== "touch") return; at = { x: event.clientX, y: event.clientY }; timer = setTimeout(() => { at = null; navigator.vibrate?.(10); onLong() }, 450) },
    onPointerMove: (event: PointerEvent) => { if (at && Math.hypot(event.clientX - at.x, event.clientY - at.y) > 8) cancel() },
    onPointerUp: cancel, onPointerCancel: cancel,
  }
}
