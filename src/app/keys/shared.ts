import { describeVersion } from "../updates"
import { merchantKey } from "../../domain/history"
import { type Hint } from "../palette"
import { changeAccountScope, settleData, showAccount } from "../actions"
import { armedText, isArmed, type Armed } from "../../state/armed"
import { type KeyEvent } from "@opentui/core"
import { accountRows, accountStacks } from "../../domain/accountTree"
import { assignableCategories, pickerSuggestions } from "../../domain/categoryOptions"
import { scopeOfKey } from "../../domain/budgetScopes"
import { type CycleConfig } from "../../domain/budget"
import { anchorDraft } from "../../state/settingsForm"
import { runSync } from "../sync"
import { isLlmRow } from "../apiKeys"
import { signOutLlm } from "../llmSignIn"
import { LLM_PROVIDERS } from "../../ai/llm"
import { type OverviewCharts, TABS, smartQuestionFor, type UiState, type UiStore } from "../../state/uiStore"
import type { DataStore } from "../../state/dataStore"
import { characters, isPrintable } from "../../domain/textField"
import { openGroups, overviewCategoryLines, overviewRange } from "../../state/overviewRange"
import { nextSavedFilterId } from "../../state/settingsConfig"

export function moveTxnCursor(
  ui: UiStore,
  data: DataStore | undefined,
  delta: number,
  withRange: boolean,
) {
  const rows = data?.scopedTransactions() ?? []
  if (rows.length === 0) { ui.jumpManagerCursor(0, 0); return }
  const prev = rows[ui.state.managerCursor]
  ui.moveManagerCursor(delta, rows.length)
  const cur = rows[ui.state.managerCursor]
  if (!cur) return
  if (withRange) {
    const anchorId = ui.state.range?.anchorId ?? prev?.id ?? cur.id
    ui.setRangeFromMove(anchorId, cur.id, true)
  } else if (ui.state.range) {
    ui.setRangeFromMove(0, 0, false)
  }
}

/** A list filtered by typing (saved filters, categories, tags, a form's
 * picker field): every printable key types into the query, so arrows and
 * ctrl+n/ctrl+p move. Approved deviation from the Go app, whose pickers
 * moved on j/k: a search must take any letter. */
export function queryPickerKey(
  key: KeyEvent,
  picker: { query: string; cursor: number },
  length: number,
  actions: {
    close: () => void
    update: (next: { query: string; cursor: number }) => void
    apply: () => void
    space?: () => void
  },
): void {
  if (key.name === "escape") { actions.close(); return }
  if (actions.space && (key.name === "space" || key.sequence === " ")) { actions.space(); return }
  const step = key.name === "down" || (key.ctrl && (key.name === "n" || key.name === "j")) ? 1 : key.name === "up" || (key.ctrl && (key.name === "p" || key.name === "k")) ? -1
    : key.name === "pagedown" ? PAGE : key.name === "pageup" ? -PAGE : key.name === "end" ? length : key.name === "home" ? -length : 0
  if (step) { actions.update({ ...picker, cursor: Math.max(0, Math.min(length - 1, picker.cursor + step)) }); return }
  if (key.name === "return" || key.name === "enter") { actions.apply(); return }
  if (key.name === "backspace") { actions.update({ query: characters(picker.query).slice(0, -1).join(""), cursor: 0 }); return }
  if (isPrintable(key)) actions.update({ query: picker.query + key.sequence, cursor: 0 })
}

/** Rows a page key moves where a list doesn't say how many it shows. */
const PAGE = 10

/** Every list's movement: j/k and the arrows a row, pageup/pagedown (and
 * ctrl+u/ctrl+d, see handleKey) a page, g/home the top, G/end the bottom.
 * List indices remain zero for empty lists. Callers include any extra create row. */
export function listMove(key: Pick<KeyEvent, "name" | "sequence" | "shift">, cursor: number, length: number, page = PAGE): number | null {
  const last = Math.max(0, length - 1)
  let next: number
  if (key.sequence === "G" || (key.name === "g" && key.shift) || key.name === "end") next = last
  else if (key.name === "g" || key.name === "home") next = 0
  else if (key.name === "j" || key.name === "down") next = cursor + 1
  else if (key.name === "k" || key.name === "up") next = cursor - 1
  else if (key.name === "pagedown") next = cursor + Math.max(1, page)
  else if (key.name === "pageup") next = cursor - Math.max(1, page)
  else return null
  return Math.max(0, Math.min(last, next))
}

/** A move to the top or bottom (g, G, home, end), not a step. */
export function isJump(key: Pick<KeyEvent, "name" | "sequence">): boolean {
  return key.name === "g" || key.sequence === "G" || key.name === "home" || key.name === "end"
}

/** A shifted letter, as terminals report it: the capital, or the letter with shift. */
export function shifted(key: Pick<KeyEvent, "name" | "sequence" | "shift">, letter: string): boolean {
  return key.sequence === letter.toUpperCase() || (key.name === letter && key.shift)
}

export function openCategoryPicker(ui: UiStore, ids: number[], data?: DataStore): void {
  ui.openCatPicker(ids)
  const repeat = data?.lastRepeat()
  if (!data || repeat?.kind !== "category" || (ui.state.catPicker?.query ?? "") || ids.some((id) => data.state.suggestions[id])) return
  // Start on the last category chosen (the list keeps its order).
  const cursor = assignableCategories(data.state.categories, "", pickerSuggestions(ids, data.state.suggestions)).findIndex((c) => c.id === repeat.categoryId)
  if (cursor >= 0) ui.setState("catPicker", { cursor })
}

/** A read-only text's first line after a scroll key (j/k a line, paging a
 * screen, g/G the ends), never past its end; null for any other key. */
export function scrolled(key: KeyEvent, top: number, total: number, visible: number): number | null {
  const screen = Math.max(1, visible)
  const step = key.name === "j" || key.name === "down" ? 1 : key.name === "k" || key.name === "up" ? -1
    : key.name === "pagedown" || (key.ctrl && key.name === "d") ? screen : key.name === "pageup" || (key.ctrl && key.name === "u") ? -screen
    : key.name === "g" && !key.shift ? -Infinity : key.name === "g" || key.name === "G" ? Infinity : 0
  return step ? Math.max(0, Math.min(Math.max(0, total - screen), top + step)) : null
}

/** Open the note box for a merchant, on its note so far. */
export function openMerchantNote(ui: UiStore, data: DataStore, merchant: string): void {
  const draft = data.state.merchantNotes[merchantKey(merchant)] ?? ""
  ui.setState({ merchantNote: { merchant: merchant.trim(), draft, caret: draft.length } })
  ui.setStatus(`Note on ${merchant.trim()} · for suggestions`)
}

const confirmations = new WeakMap<UiStore, Set<string>>()

/** del (or enter) twice (state/armed): the first press arms the row, the
 * same key on it again does it; handleKey disarms on any other key.
 * Further confirmation presses do nothing until the write settles. */
export function confirmTwice(ui: UiStore, data: DataStore | undefined, armed: Confirm, ok?: (summary: string) => void): void {
  const pending = confirmations.get(ui) ?? new Set<string>()
  const action = `${armed.kind}:${armed.id}`
  if (pending.has(action)) return
  const now = ui.state.armed
  if (now && isArmed(now, armed.kind, armed.id) && now.with === armed.with) {
    ui.disarm()
    pending.add(action)
    confirmations.set(ui, pending)
    settleData(ui, CONFIRMED[armed.kind](data, armed).finally(() => pending.delete(action)), (summary) => { ui.setStatus(summary); ok?.(summary) })
    return
  }
  ui.arm({ ...armed, promptId: ui.setStatus(armedText(armed)) })
}

type Confirm = Omit<Armed, "promptId">

/** What each armed row does on its second press, and the status it leaves. */
const CONFIRMED: Record<Confirm["kind"], (data: DataStore | undefined, c: Confirm) => Promise<string>> = {
  category: async (data, c) => { await data?.deleteSettingsCategory(Number(c.id)); return `Deleted ${c.label}` },
  tag: async (data, c) => { await data?.deleteSettingsTag(Number(c.id)); return `Deleted ${c.label}` },
  rule: async (data, c) => { await data?.deleteSettingsRule(Number(c.id)); return `Deleted ${c.label}` },
  filter: async (data, c) => { await data?.deleteSavedFilter(String(c.id)); return `Deleted ${c.label}` },
  profile: async (data, c) => { await data?.deleteImportProfile(String(c.id)); return `Deleted ${c.label}` },
  budget: async (data, c) => {
    const [key, from] = String(c.id).split("@")
    await data?.removeBudget(scopeOfKey(key!), from)
    return `Deleted ${c.label}`
  },
  clearData: async (data) => { await data?.clearDatabaseData(); return "Transaction and import data cleared" },
  clearAccount: async (data, c) => { await data?.clearAccountData(Number(c.id)); return `Cleared ${c.label}` },
  deleteAccount: async (data, c) => { await data?.removeAccountData(Number(c.id)); return `Removed ${c.label}` },


  desyncAccount: async (data, c) => `Sync off for ${c.label} · ${await data?.setAccountSync(Number(c.id), false) ?? 0} transactions removed`,
  aiKey: async (data, c) => {
    if (!data) return ""
    const row = c.id as NonNullable<UiState["aiDialog"]>["row"]
    if (isLlmRow(row)) {
      const { keyName, modelName } = LLM_PROVIDERS[row]
      await data.saveApiKeys({ [keyName]: null, [modelName]: null, ...(row === "openrouter" ? { JASKMONEY_LLM_MODEL: null } : {}) })
      await signOutLlm(data, row)
    } else await data.saveApiKeys(row === "up" ? { JASKMONEY_UP_TOKEN: null } : row === "jev" ? { JASKMONEY_JEV_TOKEN: null } : { JASKMONEY_CF_TOKEN: null, JASKMONEY_CF_ACCOUNT_ID: null })
    return `Removed what was saved for ${c.label}`
  },
}

/** Two lists stacked in one pane (Categories over Tags, Rules over Saved
 * filters), moved through as one: j off the end of the first lands on the
 * second. An empty list still takes a stop, where a adds to it. */
export function stackedMove(key: KeyEvent, first: { cursor: number; count: number }, second: { cursor: number; count: number }, onFirst: boolean, page = PAGE): { first: boolean; cursor: number } | null {
  const a = Math.max(1, first.count), b = Math.max(1, second.count)
  const at = onFirst ? Math.min(first.cursor, a - 1) : a + Math.min(second.cursor, b - 1)
  const moved = listMove(key, at, a + b, page)
  if (moved == null || moved === at) return moved == null ? null : { first: onFirst, cursor: onFirst ? at : at - a }
  return moved < a ? { first: true, cursor: moved } : { first: false, cursor: moved - a }
}

/** Taxonomy's category groups: open or closed (one row with its count). */
export function setGroupOpen(ui: UiStore, id: number, open: boolean): void {
  const ids = ui.state.taxonomyOpen.filter((other) => other !== id)
  ui.setState({ taxonomyOpen: open ? [...ids, id] : ids })
}

/** AI models: one row per provider; enter edits its key, t tests it, del
 * removes the saved one (the environment's, if any, then applies). */
/** `?` (some terminals send it as shift+/). */
export function isSmartSearchKey(key: KeyEvent): boolean {
  return key.sequence === "?" || key.name === "?" || (key.name === "/" && key.shift)
}

/** Open the filter as a smart search: `?` and a question. On a filter a
 * smart search wrote, its question comes back to reword. */
export function openSmartSearch(ui: UiStore, data?: DataStore): void {
  const question = smartQuestionFor(ui.state, data?.state.filterQuery ?? "")
  ui.openFilter(`?${question ?? ""}`)
  ui.setStatus(question ? "Reword the question · enter asks again · esc clears" : "Smart search · ask in words · enter asks · esc clears")
}

export function openTransaction(ui: UiStore, data?: DataStore): void {
  const row = data?.scopedTransactions()[ui.state.managerCursor]
  if (row) ui.setState({ detail: { id: row.id, boughtTop: 0, notes: null } })
}

export function selectAccountRow(ui: UiStore, data: DataStore, index: number): void {
  const row = accountStacks(data.state.accounts).flatMap((stack) => stack.rows)[index]
  if (row && row.selection !== data.state.accountSelection) changeAccountScope(ui, data, row.selection, "accounts")
}

export function moveOverviewCategory(ui: UiStore, data: DataStore, index: number): void {
  const lines = overviewCategoryLines(overviewRange(data, ui.state), openGroups(data.state.uiPrefs, ui.state))
  ui.setState({ overviewCategoryCursor: Math.max(0, Math.min(lines.length - 1, index)) })
}

export function openBarItem(ui: UiStore, data: DataStore | undefined, id: string): void {
  const tab = TABS.find((tab) => id === `bar.${tab.id}`)
  if (tab) ui.switchTab(tab.id)
  else if (id === "bar.sync" && data) void runSync(ui, data, { manual: true })
  else if (id === "bar.version") void showVersion(ui)
}

/** The version's word on updates, in the status line (once per change). */
export async function showVersion(ui: UiStore): Promise<void> {
  const text = await describeVersion()
  if (ui.state.status !== text) ui.setStatus(text)
}

/** ctrl+s saves the current filter (the editor opens on its name); ctrl+l
 * opens the saved filters to apply one (Go app). Both Transactions views. */
export function savedFilterKeys(ui: UiStore, data: DataStore | undefined, key: KeyEvent): boolean {
  if (!key.ctrl) return false
  if (key.name === "s") {
    const expr = data?.state.filterQuery ?? ""
    if (!expr) { ui.setStatus("No filter to save"); return true }
    ui.openSettingsEditor("filter", null, { ...ui.state.settingsDraft, id: nextSavedFilterId(data?.state.savedFilters ?? []), name: "", expr })
    ui.setState("settingsEditor", { field: 1, caret: 0 })
    return true
  }
  if (key.name === "l") { ui.setState({ filterPicker: { query: "", cursor: 0 } }); return true }
  return false
}

export type HintState = Pick<UiState, "focusedSection" | "drillReturn" | "chartViews"> & {
  rangeText?: boolean
  /** How many spending accounts: the Overview's a switches between them. */
  spendingAccounts?: number
  rangeView?: "net" | "spending"
  /** What [ and ] step the Overview's range by (stepUnit). */
  stepUnit?: string
  /** The Overview's range is a Custom one (C edits its dates). */
  customRange?: boolean
  /** The Overview's chart panes on screen (one: no bottom-chart keys). */
  overviewCharts?: OverviewCharts
  /** The Budgets tab's cycle panes on screen (none: no H/L). */
  budgetCyclePanes?: 0 | 1 | 2
  /** The Budgets tab's list is the cycle pane's Categories view. */
  budgetListInPane?: boolean
  /** From the data store: the Transactions table is the Uncategorised view. */
  uncategorisedOnly?: boolean
  /** In the filter: ↑ would bring back the smart search's question. */
  recallQuestion?: boolean
  /** The AI models dialog is taking a key, account id or model. */
  aiField?: boolean
  executorWaiting?: boolean
  welcomeStep?: string
  welcomeTyping?: boolean
  welcomeBusy?: boolean
  /** Trying a tour demo: which. */
  welcomeTry?: number | null
  /** The tour's demo shown can be tried. */
  welcomeTriable?: boolean
  boughtScrolls?: boolean
  /** The sign-in modal is asking for a pasted code or URL. */
  signInPaste?: boolean
  /** A tag review is open. */
  tagReview?: boolean
  /** The search help shows its full version. */
  searchHelp?: Pick<NonNullable<UiState["searchHelp"]>, "full"> | null
  /** Rules offered (R). */
  ruleOfferCount?: number
  /** The filter has `ask:` terms; whether near misses are shown. */
  asks?: boolean
  askLoose?: boolean
}

export type ScopeEntry = {
  handle: (ui: UiStore, key: KeyEvent, data?: DataStore) => void
  hints: (state?: HintState) => Hint[]
  /** The focused pane's name, before its keys in the footer (none: the
   * keys are the tab's or the dialog's). */
  pane?: (state?: HintState) => string | null
  /** Not text entry: the palette (ctrl+k) and the ctrl aliases work here. */
  list: boolean
}

/** Hints that are the tab's, whichever pane has focus: after the pane's. */
export const tabWide = (hints: Hint[]): Hint[] => hints.map((h) => ({ ...h, tab: true }))

/** The budget cycle as editor draft fields. */
export function cycleDraft(cycle: CycleConfig): { unit: CycleConfig["unit"]; anchor: CycleConfig["anchor"]; anchorDate: string; payEarly: boolean } {
  return { unit: cycle.unit, anchor: cycle.anchor, anchorDate: anchorDraft(cycle), payEarly: !!cycle.payEarly }
}

/** Show the next account in the accounts pane (the Transactions tab's `a`). */
export function stepAccount(ui: UiStore, data: DataStore): void {
  const rows = accountRows(data.state.accounts)
  if (!rows.length) return
  const at = rows.findIndex((row) => row.selection === data.state.accountSelection)
  showAccount(ui, data, rows[(at + 1) % rows.length]!)
}
