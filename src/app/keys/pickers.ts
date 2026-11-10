import { THEMES } from "../../themes"
import { applyTheme, theme } from "../../theme"
import { unwrap } from "solid-js/store"
import { applySavedFilter, reportError, settleData, resetTransactionCursors, keepTheme } from "../actions"
import { type KeyEvent } from "@opentui/core"
import { assignableCategories, pickerSuggestions } from "../../domain/categoryOptions"
import { tagChoices } from "../../state/tagChooser"
import { startTagReview } from "../tagReview"
import { pickerChoices } from "../../state/settingsForm"
import { runSmartSearch } from "../smartSearch"
import { searchReport, writtenText } from "../searchReport"
import { SEARCH_HELP, SEARCH_HELP_FULL } from "../../state/searchHelp"
import { runAsk } from "../ask"
import { eitherInstead, askTerms } from "../../domain/filter"
import { jumpTargets, smartQuestionFor, type ScopeId, type UiStore } from "../../state/uiStore"
import type { DataStore } from "../../state/dataStore"
import { editText } from "../../domain/textField"
import { tagPickerItems, tagPickerState } from "../../state/tagPicker"
import { savedFilterOptions } from "../../state/savedFilters"
import { count } from "../../ui/text"
import { queryPickerKey, listMove, scrolled, type ScopeEntry } from "./shared"

function handleFilterPicker(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const picker = ui.state.filterPicker
  if (!picker) return
  const items = savedFilterOptions(data?.state.savedFilters ?? [], data?.state.uiPrefs.filterUsage, picker.query)
  queryPickerKey(key, picker, items.length, {
    close: () => { ui.setState({ filterPicker: null }) },
    update: (next) => { ui.setState({ filterPicker: next }) },
    apply: () => {
      const filter = items[picker.cursor]
      if (filter && data && applySavedFilter(ui, data, filter)) {
        ui.setState({ filterPicker: null })
      }
    },
  })
}

function handleThemePicker(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const picker = ui.state.themePicker
  if (!picker) return
  if (key.name === "escape") { ui.setState({ themePicker: null }); return }
  if (key.name === "return" || key.name === "enter") { if (data) keepTheme(ui, data, THEMES[picker.cursor]!.id); return }
  const moved = listMove(key, picker.cursor, THEMES.length) ?? (key.ctrl && key.name === "j" ? Math.min(THEMES.length - 1, picker.cursor + 1) : key.ctrl && key.name === "k" ? Math.max(0, picker.cursor - 1) : null)
  if (moved == null || moved === picker.cursor) return
  ui.setState({ themePicker: { cursor: moved } })
  applyTheme(THEMES[moved]!.id)
}

function handleDryRun(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  if (key.name === "escape") { ui.setState({ dryRun: null }); return }
  const lines = ui.state.dryRun?.report?.rules.reduce((n, result) => n + 4 + result.samples.length, 0) ?? 0
  const moved = listMove(key, (ui.state.dryRun?.scroll ?? 0), Math.max(0, lines - (ui.state.dryRun?.visible ?? 10)) + 1, (ui.state.dryRun?.visible ?? 10))
  if (moved != null) ui.setState("dryRun", { scroll: moved })
}

function handleJump(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name, sequence: seq } = key
  if (name === "escape" || name === "v") {
    ui.cancelJump()
    return
  }
  const hit = jumpTargets(ui.state).find(
    (t) => t.key === name || t.key === seq,
  )
  if (hit) {
    if (ui.state.activeTab === "settings") {
      if (hit.section === "set.categories") ui.activateSettings("taxonomy", "categories", true)
      else if (hit.section === "set.tags") ui.activateSettings("taxonomy", "tags", true)
      else if (hit.section === "set.rules") ui.activateSettings("rules")
      else if (hit.section === "set.filters") ui.activateSettings("filters")
      else if (hit.section === "set.appearance") ui.activateSettings("appearance")
      else if (hit.section === "set.database") ui.activateSettings("database")
      else if (hit.section === "set.up") ui.activateSettings("up")
      else if (hit.section === "set.ai") ui.activateSettings("ai")
      return
    }
    ui.applyJump(hit.section)
    return
  }
}

function handleTagPicker(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const dialog = ui.state.tagPicker
  if (!dialog || dialog.applying) return
  const opened = ui.opening("tagPicker")
  const items = pickerChoices(tagPickerItems(data?.state.tags ?? [], data?.state.categories ?? [], data?.transactions() ?? [], ui.state.pickerTargets, dialog.query))
  queryPickerKey(key, { query: dialog.query, cursor: dialog.cursor }, items.length, {
    close: () => { opened.close(); ui.setStatus("Tags unchanged") },
    update: (next) => { opened.patch({ query: next.query, cursor: next.cursor }) },
    apply: () => {
      const targets = [...ui.state.pickerTargets]
      const patch = { ...dialog.patch }
      settleData(ui, (async () => {
        if (items[dialog.cursor]?.value === null && data) {
          const id = await data.createSettingsTag({ name: dialog.query.trim(), color: theme.blue })
          if (!opened.open) return
          patch[id] = "add"
          opened.patch({ patch })
        }
        if (!data || !Object.keys(patch).length) {
          opened.close()
          ui.setStatus("Tags unchanged")
        } else {
          opened.patch({ applying: true })
          data.applyTagPatch(targets, patch).then(
            (summary) => { opened.close(); ui.setStatus(summary, summary.includes(" failed: ")) },
            (error) => { opened.close(); reportError(ui, error) },
          )
        }
      })())
    },
    space: () => {
      const item = items[dialog.cursor]
      const targets = ui.state.pickerTargets
      if (item && typeof item.value === "number" && data && targets.length) {
        const id = item.value
        const base = tagPickerState(data.transactions(), targets, id)
        const patch = { ...dialog.patch }
        const current = patch[id]
        if (base === "some") {
          if (!current) patch[id] = "add"
          else if (current === "add") patch[id] = "remove"
          else delete patch[id]
        } else if (current) delete patch[id]
        else patch[id] = base === "all" ? "remove" : "add"
        opened.patch({ patch })
      }
    },
  })
}

function handleTagChooser(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const choices = data ? tagChoices(data.state.tags, data.tagGroups(), (ui.state.tagChooser?.query ?? "")) : []
  queryPickerKey(key, { query: (ui.state.tagChooser?.query ?? ""), cursor: (ui.state.tagChooser?.cursor ?? 0) }, choices.length, {
    close: () => { ui.setState({ tagChooser: null }); ui.setStatus("Transactions") },
    update: (next) => { ui.setState({ tagChooser: { query: next.query, cursor: next.cursor } }) },
    apply: () => {
      const choice = choices[(ui.state.tagChooser?.cursor ?? 0)]
      ui.setState({ tagChooser: null })
      if (choice && data) void startTagReview(ui, data, choice)
    },
  })
}

function handleCatPicker(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const cats = assignableCategories(data?.state.categories ?? [], (ui.state.catPicker?.query ?? ""), pickerSuggestions(ui.state.pickerTargets, data?.state.suggestions ?? {}))
  queryPickerKey(key, { query: (ui.state.catPicker?.query ?? ""), cursor: (ui.state.catPicker?.cursor ?? 0) }, cats.length, {
    close: () => { ui.closeCatPicker(); ui.setStatus("Categorize cancelled") },
    update: (next) => { ui.setState({ catPicker: { query: next.query, cursor: next.cursor } }) },
    apply: () => {
      const cat = cats[(ui.state.catPicker?.cursor ?? 0)]
      const targets = ui.state.pickerTargets
      if (cat && data && targets.length) {
        ui.closeCatPicker()
        ui.setStatus(`Categorizing ${targets.length} → ${cat.name}…`)
        let resuggest: Promise<string> | undefined
        data.categorizeTransactions(targets, cat.id, (pushed, total) => {
          if (pushed === 0 && data.state.uncategorisedOnly) {
            const left = new Set(targets)
            ui.setState({ selectedIds: Object.fromEntries(Object.entries(ui.state.selectedIds).filter(([id]) => !left.has(Number(id)))) })
          }
          if (pushed === 0) resuggest ??= data.resuggestLike(targets).then(
            (count) => count > 0 ? ` · re-suggested ${count} alike` : "",
            (error) => ` · re-suggest failed: ${error instanceof Error ? error.message : String(error)}`,
          )
          if (total) ui.setStatus(`Categorized ${targets.length} → ${cat.name} · updating Up ${pushed}/${total}…`)
        }).then(
          async (summary) => {
            const failed = summary.includes(" failed: ")
            summary += await (resuggest ?? "")
            ui.setStatus(summary, failed)
          },
          (error) => reportError(ui, error),
        )
      } else {
        ui.closeCatPicker()
        ui.setStatus("Nothing to categorize", true)
      }
    },
  })
}

function handleFilter(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "f1") { ui.setState({ searchHelp: { full: false, top: 0, visible: 0 } }); return }
  const question = smartQuestionFor(ui.state, (ui.state.filterBar?.draft ?? ""))
  if (name === "up" && question) {
    const draft = `?${question}`
    ui.setState({ filterBar: { draft, caret: draft.length } })
    ui.setStatus("Reword the question · enter asks again")
    return
  }
  if (name === "escape") {
    ui.setState({ smartQuestion: null })
    ui.closeFilter(false)
    data?.clearFilter()
    resetTransactionCursors(ui, data)
    ui.setStatus("Filter cleared")
    return
  }
  if (name === "return" || name === "enter") {
    const draft = (ui.state.filterBar?.draft ?? "")
    if (draft.trimStart().startsWith("?")) {
      if (data) void runSmartSearch(ui, data, draft, () => resetTransactionCursors(ui, data))
      return
    }
    const smart = ui.state.smartQuestion
    const written = smart && smart.expr === draft ? smart.written : undefined
    ui.closeFilter(true)
    const r = data?.commitFilter(draft) ?? { ok: true, err: "" }
    resetTransactionCursors(ui, data)
    const asks = askTerms(data?.state.filterExpr ?? null).length > 0
    if (!draft.trim()) {
      ui.setStatus("Filter cleared")
    } else if (!r.ok) {
      ui.setStatus(`Searching as typed; it can't be saved: ${r.err}`, true)
    } else if (asks) {
      ui.setStatus([written ? writtenText(written) : "", "Jev judging…"].filter(Boolean).join(" · "))
    } else if (data && !data.scopedTransactions().length) {
      const either = eitherInstead(data.state.filterExpr ? unwrap(data.state.filterExpr) : null, data.accountScoped())
      ui.setStatus(either ? `No row has all of those words · for any of them: ${either}` : "No matches · F1 for search help")
    } else {
      ui.setStatus(searchReport({ written, rows: data?.scopedTransactions().length ?? 0 }))
    }
    if (data && r.ok) void runAsk(ui, data, written)
    return
  }
  const next = editText({ value: (ui.state.filterBar?.draft ?? ""), caret: (ui.state.filterBar?.caret ?? 0) }, key)
  if (next) {
    ui.setState({ filterBar: { draft: next.value, caret: next.caret } })
    if (next.value.trimStart().startsWith("?")) return
    data?.setFilterLive(next.value)
    resetTransactionCursors(ui, data)
  }
}

function handleSearchHelp(ui: UiStore, key: KeyEvent): void {
  if (["escape", "return", "enter", "f1", "q"].includes(key.name)) { ui.setState({ searchHelp: null }); return }
  if (key.name === "m") { ui.setState("searchHelp", { full: !(ui.state.searchHelp?.full ?? false), top: 0 }); return }
  const top = scrolled(key, (ui.state.searchHelp?.top ?? 0), ((ui.state.searchHelp?.full ?? false) ? SEARCH_HELP_FULL : SEARCH_HELP).length, (ui.state.searchHelp?.visible ?? 0))
  if (top != null) ui.setState("searchHelp", { top })
}

function handleMerchantNote(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const box = ui.state.merchantNote
  if (!box) return
  const { name } = key
  if (name === "escape") { ui.setState({ merchantNote: null }); ui.setStatus("Note unchanged"); return }
  if (name === "return" || name === "enter") {
    ui.setState({ merchantNote: null })
    if (!data) return
    const note = box.draft.trim()
    ui.setStatus(`${note ? "Note saved" : "Note removed"} · ${box.merchant}`)
    void data.setMerchantNote(box.merchant, note).then(
      (n) => { if (n) ui.setStatus(`${note ? "Note saved" : "Note removed"} · ${box.merchant} · re-suggested ${count(n, "row")}`) },
      (error) => reportError(ui, error),
    )
    return
  }
  const next = editText({ value: box.draft, caret: box.caret }, key)
  if (next) ui.setState("merchantNote", { draft: next.value, caret: next.caret })
}

export const pickersScopes = {
  "filterPicker": {
    handle: handleFilterPicker,
    list: false,
    hints: () => [{ key: "↑↓ ^j/k", desc: "move" }, { key: "enter", desc: "apply" }, { key: "esc", desc: "close" }, { key: "type", desc: "filter" }],
  },
  "themePicker": {
    handle: handleThemePicker,
    list: false,
    hints: () => [{ key: "↑↓ j/k", desc: "preview" }, { key: "enter", desc: "keep" }, { key: "esc", desc: "put back" }],
  },
  "dryRun": {
    handle: handleDryRun,
    list: false,
    hints: () => [{ key: "j/k", desc: "scroll" }, { key: "esc", desc: "close" }],
  },
  "jump": {
    handle: handleJump,
    list: false,
    hints: () => [
      { key: "letter", desc: "jump" },
      { key: "esc", desc: "cancel" },
    ],
  },
  "tagPicker": {
    handle: handleTagPicker,
    list: false,
    hints: () => [
      { key: "↑↓ ^j/k", desc: "move" },
      { key: "space", desc: "stage" },
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "cancel" },
    ],
  },
  "tagChooser": {
    handle: handleTagChooser,
    list: false,
    hints: () => [{ key: "↑↓ ^j/k", desc: "move" }, { key: "type", desc: "filter or new tag" }, { key: "enter", desc: "find" }, { key: "esc", desc: "cancel" }],
  },
  "catPicker": {
    handle: handleCatPicker,
    list: false,
    hints: () => [
      { key: "↑↓ ^j/k", desc: "move" },
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "cancel" },
      { key: "type", desc: "filter" },
    ],
  },
  "filter": {
    handle: handleFilter,
    list: false,
    hints: (state) => [
      { key: "enter", desc: "apply" },
      { key: "esc", desc: "clear" },
      { key: "type", desc: "JQL" },
      { key: "?…", desc: "ask in words" },
      { key: "F1", desc: "help" },
      ...(state?.recallQuestion ? [{ key: "↑", desc: "your question" }] : []),
    ],
  },
  "searchHelp": {
    handle: handleSearchHelp,
    list: false,
    hints: (state) => [{ key: "m", desc: state?.searchHelp?.full ? "brief" : "full grammar" }, { key: "j/k", desc: "scroll" }, { key: "esc", desc: "close" }],
  },
  "merchantNote": {
    handle: handleMerchantNote,
    list: false,
    hints: () => [{ key: "enter", desc: "save (empty removes)" }, { key: "esc", desc: "cancel" }],
  },
} satisfies Partial<Record<ScopeId, ScopeEntry>>

