import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { accountStacks } from "../domain/accountTree"
import { assignableCategories } from "../domain/categoryOptions"
import { filterTerm } from "../domain/filter"
import { fuzzyScore } from "../domain/fuzzy"
import { data, run, say, setTab, TABS } from "./store"
import "./palette.css"

type Command = { label: string; category: string; run: () => void; disabled?: boolean }

export function Palette(props: { onClose: () => void }) {
  const { onClose } = props
  const [query, setQuery] = createSignal("")
  const [cursor, setCursor] = createSignal(0)
  let input!: HTMLInputElement
  let list!: HTMLDivElement
  let closed = false
  onCleanup(() => { closed = true })

  const commands = createMemo<Command[]>(() => {
    const undo = data.undoLabel()
    const filter = (expr: string) => {
      const result = data.commitFilter(expr)
      if (!result.ok) say(result.err, true)
      setTab("transactions")
    }
    return [
      { label: "Review uncategorised", category: "Transactions", run: () => {
        data.setUncategorisedOnly(true)
        setTab("transactions")
        void run(data.suggestCategories(data.scopedTransactions().map((t) => t.id)))
      } },
      { label: "Filter…", category: "Transactions", run: () => {
        setTab("transactions")
        requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".search input")?.focus())
      } },
      { label: "Clear the filter", category: "Transactions", disabled: !data.state.filterQuery, run: () => data.clearFilter() },
      { label: undo ? `Undo ${undo}` : "Undo", category: "Transactions", disabled: !undo, run: () => { void run(data.undo()) } },
      ...data.state.savedFilters.map((saved): Command => ({ label: `Filter: ${saved.name}`, category: "Transactions", run: () => filter(saved.expr) })),
      ...assignableCategories(data.state.categories, "").map((category): Command => ({ label: `Show ${category.name}`, category: "Categories", run: () => filter(filterTerm("cat", category.name)) })),
      ...data.state.tags.map((tag): Command => ({ label: `Show tag ${tag.name}`, category: "Tags", run: () => filter(filterTerm("tag", tag.name)) })),
      ...accountStacks(data.state.accounts).flatMap((stack) => stack.rows.map((row): Command => ({
        label: `Show ${row.label}`, category: "Accounts", run: () => { data.setAccountSelection(row.selection); setTab("transactions") },
      }))),
      { label: "Sync with Up", category: "Data", disabled: !data.state.upToken || data.state.demo || data.state.upSyncing, run: () => {
        say("Syncing with Up…")
        void run(data.syncUp())
      } },
      ...TABS.map((tab): Command => ({ label: tab.label, category: "Go to", run: () => setTab(tab.id) })),
    ]
  })
  const matches = createMemo(() => {
    const q = query().trim()
    if (!q) return commands()
    return commands().flatMap((command, order) => {
      const score = Math.max(fuzzyScore(q, command.label) ?? -Infinity, fuzzyScore(q, command.category) ?? -Infinity)
      return score === -Infinity ? [] : [{ command, score, order }]
    }).sort((a, b) => b.score - a.score || a.order - b.order).map((entry) => entry.command)
  })
  const enabled = createMemo(() => matches().filter((command) => !command.disabled))
  const selected = createMemo(() => enabled()[Math.min(cursor(), enabled().length - 1)])
  const execute = (command: Command) => {
    if (command.disabled) return
    command.run()
    onClose()
  }
  const keydown = (event: KeyboardEvent) => {
    const target = event.target
    if (target instanceof HTMLElement && target !== input
      && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
    event.stopPropagation()
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey) return
    if (event.key === "Escape") { event.preventDefault(); onClose() }
    else if (event.key === "Enter") { event.preventDefault(); const command = selected(); if (command) execute(command) }
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      const length = enabled().length
      if (!length) return
      setCursor((Math.min(cursor(), length - 1) + (event.key === "ArrowDown" ? 1 : -1) + length) % length)
      queueMicrotask(() => { if (!closed) list.querySelector(".item.on")?.scrollIntoView({ block: "nearest" }) })
    }
  }
  onMount(() => input.focus())

  return (
    <Portal>
      <div class="backdrop" onClick={onClose} />
      <div class="popover palette" role="dialog" aria-modal="true" aria-label="All commands" onKeyDown={keydown}>
        <div class="head">
          <div class="group">All commands</div>
          <input ref={input} class="field" aria-label="Search commands" placeholder="Search commands…" autocomplete="off"
            value={query()} onInput={(event) => { setQuery(event.currentTarget.value); setCursor(0) }} />
        </div>
        <div ref={list} class="list">
          <Show when={matches().length} fallback={<div class="empty">No commands match.</div>}>
            <For each={matches()}>{(command) => (
              <button type="button" class="item" classList={{ on: selected() === command }} disabled={command.disabled}
                onMouseEnter={() => { const index = enabled().indexOf(command); if (index >= 0) setCursor(index) }}
                onClick={() => execute(command)}>
                <span>{command.label}</span><span class="aside faint">{command.category}</span>
              </button>
            )}</For>
          </Show>
        </div>
      </div>
    </Portal>
  )
}
