import { Show, For, createMemo, createEffect } from "solid-js"
import { ui, jumpTargets, type TabId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { tone, theme, ink } from "../../theme"
import { Modal } from "./Modal"
import { S } from "./S"
import { savedFilterItems, savedFilterOptions } from "../../state/savedFilters"
import { ListPicker } from "./ListPicker"
import { tagChoices, tagChooserItems } from "../../state/tagChooser"
import { merchantKey } from "../../domain/history"
import { TextInput } from "./TextInput"
import { tagPickerItems, tagPickerState } from "../../state/tagPicker"
import { count } from "../text"
import { useTerminalDimensions } from "@opentui/solid"
import { SEARCH_HELP, SEARCH_HELP_FULL, SEARCH_HELP_WIDTH, type HelpTone } from "../../state/searchHelp"

const TONE: Record<HelpTone, string> = { get head() { return ink.heading }, get key() { return tone.key }, get text() { return ink.note }, get muted() { return ink.note } }

/** F1 in the search bar: JQL, brief (the language in a sentence, an
 * example, the terms, precedence, gotchas) or full (m: what the rule
 * writer's model is given); scrolls when the screen is too short for it. */
export function SearchHelp() {
  const dims = useTerminalDimensions()
  const lines = () => ((ui.state.searchHelp?.full ?? false) ? SEARCH_HELP_FULL : SEARCH_HELP)
  // The modal's border and hint lines, and a line of air above and below.
  const visible = createMemo(() => Math.max(5, Math.min(lines().length, dims().height - 8)))
  createEffect(() => { if (ui.state.searchHelp && (ui.state.searchHelp?.visible ?? 0) !== visible()) ui.setState("searchHelp", { visible: visible() }) })
  const top = () => Math.min((ui.state.searchHelp?.top ?? 0), lines().length - visible())
  const toggle = () => ((ui.state.searchHelp?.full ?? false) ? "m brief" : "m full grammar")
  const hints = () => visible() < lines().length
    ? `${toggle()} · j/k scroll · ${top() + 1}–${top() + visible()} of ${lines().length} · esc close`
    : `${toggle()} · esc close`
  return (
    <Show when={ui.state.searchHelp}>
      <Modal title="JQL" subtitle={(ui.state.searchHelp?.full ?? false) ? "Jask Query Language, in full" : "Jask Query Language"} width={SEARCH_HELP_WIDTH + 4} hints={hints()}>
        <For each={lines().slice(top(), top() + visible())}>
          {(line) => (
            <text wrapMode="none">
              {line.length ? <For each={line}>{(part) => <S fg={TONE[part.tone]} bold={part.tone === "head"}>{part.text}</S>}</For> : " "}
            </text>
          )}
        </For>
      </Modal>
    </Show>
  )
}

export function TagPicker() {
  return <Show when={ui.state.tagPicker !== null}><OpenTagPicker /></Show>
}

/** The open picker: its rows (with counts over every row) are made only
 * while it shows. */
function OpenTagPicker() {
  const items = createMemo(() => tagPickerItems(data.state.tags, data.state.categories, data.transactions(), ui.state.pickerTargets, ui.state.tagPicker?.query ?? ""))
  const mark = (value: string | number | null) => {
    // The create row: a plus in the checkbox column.
    if (value === null) return " + "
    const id = Number(value)
    const patch = ui.state.tagPicker!.patch[id]
    const state = patch === "add" ? "all" : patch === "remove" ? "none"
      : tagPickerState(data.transactions(), ui.state.pickerTargets, id)
    return state === "all" ? "[x]" : state === "some" ? "[-]" : "[ ]"
  }
  return (
      <ListPicker
        title="Tags"
        subtitle={count(ui.state.pickerTargets.length, "transaction")}
        items={items()}
        cursor={ui.state.tagPicker!.cursor}
        query={ui.state.tagPicker!.query}
        mark={mark}
        hints="↑↓ ^j/k move · space stage · enter apply · esc cancel"
      />
  )
}

/** n (Merchants) or N (a row): what you buy at a merchant, in words, shown
 * to Jev with its rows. Says why the merchant was flagged, when it was. */
export function MerchantNoteBox() {
  return (
    <Show when={ui.state.merchantNote}>
      {(box: () => NonNullable<typeof ui.state.merchantNote>) => {
        const why = () => {
          const prompt = data.notePrompts().get(merchantKey(box().merchant))
          if (!prompt) return null
          if (prompt.kind === "varies") return "What you buy here varies, so suggestions for it are guesses."
          const category = data.state.categories.find((c) => c.id === prompt.categoryId)?.name ?? "one category"
          return `Nearly always ${category} so far, but its name reads as broad, so suggestions for it are guesses.`
        }
        return (
          <Modal title={`Note · ${box().merchant}`} subtitle="for suggestions" width={72} hints="enter save · empty removes · esc cancel">
            <Show when={why()}>{(text: () => string) => <text fg={ink.note}>{text()}</text>}</Show>
            <text fg={ink.note}>What you buy here, e.g. "varies: gifts, homewares" or "always groceries".</text>
            <text fg={ink.label}>Note: <TextInput field={{ value: box().draft, caret: box().caret }} focused /></text>
          </Modal>
        )
      }}
    </Show>
  )
}

/** T: the tag to find transactions for: yours, groups found in the
 * history (trips, subscriptions), or a new name typed. */
export function TagChooser() {
  return <Show when={(ui.state.tagChooser != null)}><OpenTagChooser /></Show>
}

/** The open chooser: its rows are worked out only while it shows (they
 * walk the whole history). */
function OpenTagChooser() {
  const items = createMemo(() => tagChooserItems(tagChoices(data.state.tags, data.tagGroups(), (ui.state.tagChooser?.query ?? "")), data.transactions(), data.state.categories))
  return (
      <ListPicker
        title="Find transactions for a tag"
        subtitle="tag review"
        items={items()}
        cursor={(ui.state.tagChooser?.cursor ?? 0)}
        query={(ui.state.tagChooser?.query ?? "")}
        width={84}
        hints="↑↓ ^j/k move · type to filter or name a new tag · enter find · esc cancel"
      />
  )
}

/** ctrl+l in Transactions: the saved filters, most recently used first,
 * each with its expression. */
export function SavedFilterPicker() {
  return (
    <Show when={ui.state.filterPicker}>
      {(picker: () => NonNullable<typeof ui.state.filterPicker>) => (
        <ListPicker
          title="Saved filters"
          items={savedFilterItems(savedFilterOptions(data.state.savedFilters, data.state.uiPrefs.filterUsage, picker().query))}
          cursor={picker().cursor}
          query={picker().query}
          width={72}
          hints="↑↓ ^j/k move · enter apply · esc close · type filter"
        />
      )}
    </Show>
  )
}

/** Jump mode: the tab's targets, each behind its key as a badge (Go app). */
export function JumpOverlay(props: { active: boolean; tab: TabId }) {
  return (
    <Show when={props.active}>
      <Modal title="Jump" width={40} hints="press a key to focus · esc cancel">
        <For each={jumpTargets({ activeTab: props.tab, overviewCharts: ui.state.overviewCharts, budgetCyclePanes: ui.state.budgetCyclePanes, chartViews: ui.state.chartViews })}>
          {(t) => (
            <text wrapMode="none">
              <S fg={theme.rowCursorText} bg={tone.key} bold>{`[${t.key}]`}</S>
              <S fg={ink.figure}>{` ${t.label}`}</S>
            </text>
          )}
        </For>
      </Modal>
    </Show>
  )
}

/** The top bar: the tabs, and the demo flag, accounts, version and sync on
 * its right. */
