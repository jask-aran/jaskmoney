import { For, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { Portal } from "solid-js/web"
import { accountStacks } from "../domain/accountTree"
import { assignableCategories } from "../domain/categoryOptions"
import { filterTerm } from "../domain/filter"
import { fuzzyScore } from "../domain/fuzzy"
import { data, run, say, setTab, TABS } from "./store"
import { Item, Overlay, OverlayBar, OverlayEmpty, OverlayHints, OverlayList, Scrim, Section } from "./v2"
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
  const sections = createMemo(() => {
    const groups = new Map<string, Command[]>()
    for (const command of commands()) {
      if (!groups.has(command.category)) groups.set(command.category, [])
    }
    for (const command of matches()) groups.get(command.category)?.push(command)
    return Array.from(groups, ([category, commands]) => ({ category, commands })).filter((group) => group.commands.length)
  })
  const enabled = createMemo(() => sections().flatMap((section) => section.commands).filter((command) => !command.disabled))
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
      queueMicrotask(() => { if (!closed) list.querySelector("[data-highlighted]")?.scrollIntoView({ block: "nearest" }) })
    }
  }
  onMount(() => input.focus())

  return (
    <Portal>
      <Scrim dialog placement="top" onClick={(event) => { if (event.target === event.currentTarget) onClose() }} onKeyDown={keydown}>
        <Overlay label="Commands" class="palette-overlay">
          <OverlayBar placeholder="Search commands…" value={query()} onInput={(value) => { setQuery(value); setCursor(0) }} onClose={onClose}
            field={{ ref: (element) => { input = element }, "aria-label": "Search commands", autocomplete: "off" }} />
          <OverlayList ref={list} managed>
            <Show when={matches().length} fallback={<OverlayEmpty>No commands match.</OverlayEmpty>}>
              <For each={sections()}>{(section) => (
                <Section title={section.category}>
                  <For each={section.commands}>{(command) => (
                    <Item active={selected() === command} disabled={command.disabled}
                      tabIndex={command.disabled ? undefined : 0} aria-disabled={command.disabled || undefined}
                      onKeyDown={(event) => { if (event.key === " " && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey) event.preventDefault() }}
                      onKeyUp={(event) => { if (event.key === " " && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey) execute(command) }}
                      onCursor={() => { const index = enabled().indexOf(command); if (index >= 0) setCursor(index) }}
                      onClick={() => execute(command)}>{command.label}</Item>
                  )}</For>
                </Section>
              )}</For>
            </Show>
          </OverlayList>
          <OverlayHints start={[[["↑", "↓"], "move"], [["↵"], "run"], [["esc"], "close"]]} />
        </Overlay>
      </Scrim>
    </Portal>
  )
}
