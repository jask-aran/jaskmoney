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

const PAGE = 10

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

export function isJump(key: Pick<KeyEvent, "name" | "sequence">): boolean {
  return key.name === "g" || key.sequence === "G" || key.name === "home" || key.name === "end"
}

export function shifted(key: Pick<KeyEvent, "name" | "sequence" | "shift">, letter: string): boolean {
  return key.sequence === letter.toUpperCase() || (key.name === letter && key.shift)
}

export function openCategoryPicker(ui: UiStore, ids: number[], data?: DataStore): void {
  ui.openCatPicker(ids)
  const repeat = data?.lastRepeat()
  if (!data || repeat?.kind !== "category" || (ui.state.catPicker?.query ?? "") || ids.some((id) => data.state.suggestions[id])) return
  const cursor = assignableCategories(data.state.categories, "", pickerSuggestions(ids, data.state.suggestions)).findIndex((c) => c.id === repeat.categoryId)
  if (cursor >= 0) ui.setState("catPicker", { cursor })
}

export function scrolled(key: KeyEvent, top: number, total: number, visible: number): number | null {
  const screen = Math.max(1, visible)
  const step = key.name === "j" || key.name === "down" ? 1 : key.name === "k" || key.name === "up" ? -1
    : key.name === "pagedown" || (key.ctrl && key.name === "d") ? screen : key.name === "pageup" || (key.ctrl && key.name === "u") ? -screen
    : key.name === "g" && !key.shift ? -Infinity : key.name === "g" || key.name === "G" ? Infinity : 0
  return step ? Math.max(0, Math.min(Math.max(0, total - screen), top + step)) : null
}

export function openMerchantNote(ui: UiStore, data: DataStore, merchant: string): void {
  const draft = data.state.merchantNotes[merchantKey(merchant)] ?? ""
  ui.setState({ merchantNote: { merchant: merchant.trim(), draft, caret: draft.length } })
  ui.setStatus(`Note on ${merchant.trim()} · for suggestions`)
}

const confirmations = new WeakMap<UiStore, Set<string>>()

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

export function stackedMove(key: KeyEvent, first: { cursor: number; count: number }, second: { cursor: number; count: number }, onFirst: boolean, page = PAGE): { first: boolean; cursor: number } | null {
  const a = Math.max(1, first.count), b = Math.max(1, second.count)
  const at = onFirst ? Math.min(first.cursor, a - 1) : a + Math.min(second.cursor, b - 1)
  const moved = listMove(key, at, a + b, page)
  if (moved == null || moved === at) return moved == null ? null : { first: onFirst, cursor: onFirst ? at : at - a }
  return moved < a ? { first: true, cursor: moved } : { first: false, cursor: moved - a }
}

export function setGroupOpen(ui: UiStore, id: number, open: boolean): void {
  const ids = ui.state.taxonomyOpen.filter((other) => other !== id)
  ui.setState({ taxonomyOpen: open ? [...ids, id] : ids })
}

export function isSmartSearchKey(key: KeyEvent): boolean {
  return key.sequence === "?" || key.name === "?" || (key.name === "/" && key.shift)
}

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

export async function showVersion(ui: UiStore): Promise<void> {
  const text = await describeVersion()
  if (ui.state.status !== text) ui.setStatus(text)
}

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
  spendingAccounts?: number
  rangeView?: "net" | "spending"
  stepUnit?: string
  customRange?: boolean
  overviewCharts?: OverviewCharts
  budgetCyclePanes?: 0 | 1 | 2
  budgetListInPane?: boolean
  uncategorisedOnly?: boolean
  recallQuestion?: boolean
  aiField?: boolean
  executorWaiting?: boolean
  welcomeStep?: string
  welcomeTyping?: boolean
  welcomeBusy?: boolean
  welcomeTry?: number | null
  welcomeTriable?: boolean
  boughtScrolls?: boolean
  signInPaste?: boolean
  tagReview?: boolean
  searchHelp?: Pick<NonNullable<UiState["searchHelp"]>, "full"> | null
  ruleOfferCount?: number
  asks?: boolean
  askLoose?: boolean
}

export type ScopeEntry = {
  handle: (ui: UiStore, key: KeyEvent, data?: DataStore) => void
  hints: (state?: HintState) => Hint[]
  pane?: (state?: HintState) => string | null
  list: boolean
}

export const tabWide = (hints: Hint[]): Hint[] => hints.map((h) => ({ ...h, tab: true }))

export function cycleDraft(cycle: CycleConfig): { unit: CycleConfig["unit"]; anchor: CycleConfig["anchor"]; anchorDate: string; payEarly: boolean } {
  return { unit: cycle.unit, anchor: cycle.anchor, anchorDate: anchorDraft(cycle), payEarly: !!cycle.payEarly }
}

export function stepAccount(ui: UiStore, data: DataStore): void {
  const rows = accountRows(data.state.accounts)
  if (!rows.length) return
  const at = rows.findIndex((row) => row.selection === data.state.accountSelection)
  showAccount(ui, data, rows[(at + 1) % rows.length]!)
}
