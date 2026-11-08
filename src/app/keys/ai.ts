import { chooseModel, modelItems, openModelPicker } from "../modelPicker"
import { settleData } from "../actions"
import { type KeyEvent } from "@opentui/core"
import { pickerChoices } from "../../state/settingsForm"
import { previewSent } from "../sentPreview"
import { askTerms } from "../../domain/filter"
import { cancelExecutorSignIn, openExecutorDialog, runExecutorAction } from "../executorSource"
import { executorActions } from "../../state/executorDialog"
import { AI_ROWS, aiRowLabel, isLlmRow, testAi } from "../apiKeys"
import { KEY_PAGES, aiPaneRows, aiActions, aiContext, aiDialogFor, useActions, type AiUse } from "../../state/aiDialog"
import { useQueries, type QueryId } from "../../ai/catalog"
import { hasWorkersAi } from "../../ai/workersAi"
import { cancelLlmSignIn, openBrowser, startLlmSignIn, submitSignInPaste } from "../llmSignIn"
import { createLlm, LLM_PROVIDERS } from "../../ai/llm"
import { credentialEnv } from "../../ai/credentials"
import { type ScopeId, type UiState, type UiStore } from "../../state/uiStore"
import type { DataStore } from "../../state/dataStore"
import { editText } from "../../domain/textField"
import { queryPickerKey, listMove, scrolled, confirmTwice, type ScopeEntry } from "./shared"

/** The model picker: type to filter, ↑↓ move, enter use it, esc leave it as it was. */
function handleModelPicker(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const picker = ui.state.modelPicker
  if (!picker || !data) return
  const choices = pickerChoices(modelItems(picker.provider, picker.query))
  queryPickerKey(key, picker, choices.length, {
    close: () => ui.setState({ modelPicker: null }),
    update: (next) => ui.setState("modelPicker", next),
    apply: () => { const choice = choices[picker.cursor]; if (choice) chooseModel(ui, data, picker.provider, String(choice.value)) },
  })
}

/** Settings › AI models: the models, the uses, then the sources; enter opens the one at the cursor. */
function handleSettingsAi(ui: UiStore, key: KeyEvent): void {
  const { name } = key
  if (name === "escape") { ui.leaveSettings(); return }
  // Models, then sources (Executor: Gmail and your other accounts), then uses.
  const rows = aiPaneRows(AI_ROWS)
  const moved = listMove(key, ui.state.aiCursor, rows.length)
  if (moved != null) { ui.setState({ aiCursor: moved }); return }
  if (name !== "return" && name !== "enter") return
  const row = rows[Math.min(ui.state.aiCursor, rows.length - 1)]!
  if (row.kind === "source") settleData(ui, openExecutorDialog(ui))
  else if (row.kind === "use") ui.setState({ aiUse: { use: row.use, cursor: 0, note: null } })
  else openAiDialog(ui, row.row)
}

export const openAiDialog = (ui: UiStore, row: NonNullable<UiState["aiDialog"]>["row"]) => ui.setState({ aiDialog: aiDialogFor(row) })

/** A use's dialog: j/k move over its queries, then its model actions;
 * enter opens a query (what it asks, its context, the exact request) or
 * runs the action: choose the model, connect one it needs; esc closes. */
function handleAiUse(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const dialog = ui.state.aiUse
  if (!dialog || !data) return
  const { name } = key
  if (name === "escape") { ui.setState({ aiUse: null }); return }
  const queries = useQueries(dialog.use)
  const actions = useActions(dialog.use, aiContext(data))
  const moved = listMove(key, dialog.cursor, queries.length + actions.length)
  if (moved != null) { ui.setState("aiUse", { cursor: moved }); return }
  if (name !== "return" && name !== "enter") return
  const query = queries[dialog.cursor]
  if (query) { void openQuery(ui, data, dialog.use, query); return }
  const action = actions[dialog.cursor - queries.length]
  if (!action) return
  const opened = ui.opening("aiUse")
  const note = (text: string) => opened.patch({ note: { text, ok: true } })
  switch (action.id) {
    case "clairic":
      settleData(ui, data.saveApiKeys({ JASKMONEY_SEARCH_CLAIRIC: action.on ? null : "off" }), () => note(action.on ? "Smart search asks Clairic for the words and dates" : "Smart search asks Jev alone"))
      return
    case "provider":
      settleData(ui, data.saveApiKeys({ JASKMONEY_LLM_PROVIDER: action.provider }), () => note(`${LLM_PROVIDERS[action.provider].label} now writes rules`))
      return
    case "model":
      openModelPicker(ui, action.provider)
      return
    case "connect":
      ui.setState({ aiUse: null, aiCursor: AI_ROWS.indexOf(action.row) })
      openAiDialog(ui, action.row)
  }
}

/** Show a query, and build its exact request (nothing is sent). */
async function openQuery(ui: UiStore, data: DataStore, use: AiUse, query: QueryId): Promise<void> {
  ui.setState({ aiSent: { use, query, part: null, error: null, top: 0, visible: 0, lines: 0 } })
  const opened = ui.opening("aiSent")
  const current = () => opened.open && ui.state.aiSent?.query === query
  try {
    const askWords = askTerms(data.state.filterExpr)[0]
    const parts = await previewSent(use, data, { smartQuestion: ui.state.smartQuestion?.question, ...(askWords ? { askWords } : {}), clairic: aiContext(data).searchClairic && hasWorkersAi() })
    const part = parts.find((p) => p.query === query)
    if (current()) opened.patch(part ? { part } : { error: "Nothing to build it for yet: it needs rows of the kind it asks about." })
  } catch (error) {
    if (current()) opened.patch({ error: error instanceof Error ? error.message : String(error) })
  }
}

/** A query's view: it scrolls; esc goes back to the use. */
function handleAiSent(ui: UiStore, key: KeyEvent): void {
  const view = ui.state.aiSent
  if (!view) return
  if (key.name === "escape" || key.name === "q") { ui.setState({ aiSent: null }); return }
  const top = scrolled(key, view.top, view.lines, view.visible)
  if (top != null) ui.setState("aiSent", { top })
}

/** The AI models dialog: j/k pick an action, enter runs it; a field (key,
 * account id, model) takes typing and pasting until enter saves or esc
 * backs out; remove needs enter twice; esc closes. */
/** Executor's dialog (app/executorSource): j/k over the actions, enter runs
 * one; esc cancels a browser sign-in in progress and closes. */
function handleExecutor(ui: UiStore, key: KeyEvent): void {
  const dialog = ui.state.executor
  if (!dialog) return
  if (key.name === "escape") { cancelExecutorSignIn(); ui.setState({ executor: null }); return }
  if (dialog.waiting) return
  const moved = listMove(key, dialog.cursor, executorActions(dialog.status).length)
  if (moved != null) { ui.setState("executor", { cursor: moved }); return }
  if (key.name === "return" || key.name === "enter") settleData(ui, runExecutorAction(ui))
}

function handleAiDialog(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const dialog = ui.state.aiDialog
  if (!dialog || !data) return
  const { name } = key
  const row = dialog.row
  // Work that finishes after the dialog closed writes nothing (Opening).
  const opened = ui.opening("aiDialog")
  const note = (text: string, ok: boolean | null) => opened.patch({ note: { text, ok }, busy: false })
  if (dialog.field) {
    if (dialog.busy && name !== "escape") return
    const field = dialog.field
    if (name === "escape") { opened.patch({ field: null }); return }
    if (name === "return" || name === "enter") {
      const value = field.value.trim()
      opened.patch({ busy: true })
      settleData(ui, (async () => {
        try {
          if (field.action === "key") {
            if (!value) { opened.patch({ field: null }); return }
            await data.saveApiKeys(row === "up" ? { JASKMONEY_UP_TOKEN: value } : row === "jev" ? { JASKMONEY_JEV_TOKEN: value } : row === "workersAi" ? { JASKMONEY_CF_TOKEN: value } : { [LLM_PROVIDERS[row].keyName]: value })
            // Clairic's account comes from its token: nobody has to find the ID.
            if (row === "workersAi") {
              const found = await data.findCloudflareAccount().catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) }))
              opened.patch({ field: null, note: "name" in found ? { text: `Token saved · account: ${found.name}`, ok: true }
                : "count" in found ? { text: `Token saved · it reaches ${found.count} accounts: enter the account ID`, ok: null }
                : { text: `Token saved, but Cloudflare didn't list its account (${found.error}): enter the account ID`, ok: false } })
              return
            }
            opened.patch({ field: null, note: { text: row === "up" ? "Token saved · Test checks it; s in Up Bank syncs" : "Key saved", ok: true } })
          } else if (field.action === "accountId") {
            await data.saveApiKeys({ JASKMONEY_CF_ACCOUNT_ID: value || null })
            opened.patch({ field: null, note: { text: value ? "Account ID saved" : "Account ID removed", ok: true } })
          } else if (isLlmRow(row)) {
            const { modelName, defaultModel } = LLM_PROVIDERS[row]
            // An id the provider doesn't have is refused; the default isn't saved, so it follows the app's.
            createLlm({ provider: row, apiKey: "x", modelId: value || defaultModel })
            await data.saveApiKeys({ [modelName]: value && value !== defaultModel ? value : null, ...(row === "openrouter" ? { JASKMONEY_LLM_MODEL: null } : {}) })
            opened.patch({ field: null, note: { text: `Model: ${value || defaultModel}`, ok: true } })
          }
        } catch (e) {
          note(e instanceof Error ? e.message : String(e), false)
        } finally { opened.patch({ busy: false }) }
      })())
      return
    }
    // A key is never shown, so edits apply at its end.
    const next = editText({ value: field.value, caret: field.action === "key" ? field.value.length : field.caret }, key)
    if (next) ui.setState("aiDialog", "field", { value: next.value, caret: next.caret })
    return
  }
  const ctx = aiContext(data)
  const actions = aiActions(row, ctx)
  if (name === "escape") { opened.close(); return }
  const moved = listMove(key, dialog.cursor, actions.length)
  if (moved != null) { opened.patch({ cursor: moved }); return }
  if (name !== "return" && name !== "enter") return
  const action = actions[Math.min(dialog.cursor, actions.length - 1)]
  if (!action || dialog.busy) return
  switch (action.id) {
    case "signIn":
      if (isLlmRow(row)) settleData(ui, startLlmSignIn(ui, data, row), (result) => { if (result) note(result.text, result.ok) })
      return
    case "model":
      // A list of the provider's models, not a slug to type.
      if (isLlmRow(row)) openModelPicker(ui, row)
      return
    case "key":
    case "accountId": {
      const value = action.id === "accountId" ? (credentialEnv().JASKMONEY_CF_ACCOUNT_ID ?? "") : ""
      opened.patch({ field: { action: action.id, value, caret: value.length }, note: null })
      return
    }
    case "page": {
      const page = KEY_PAGES[row]
      if (page) { openBrowser(page.url); note(`${page.site} should open in your browser; paste the key here when you have it`, null) }
      return
    }
    case "test":
      opened.patch({ busy: true, note: { text: "Testing…", ok: null } })
      void testAi(row).then((result) => note(result.text, result.ok))
      return
    case "remove":
      // Enter twice (state/armed); moving off the row disarms, like any key.
      confirmTwice(ui, data, { kind: "aiKey", id: row, label: aiRowLabel(row), with: "enter" }, (text) => opened.patch({ cursor: 0, note: { text, ok: true } }))
      return
  }
}

/** The browser sign-in modal: it owns input; esc cancels, and when pi-ai
 * asks, the code or redirect URL is typed or pasted and enter sends it. */
function handleLlmSignIn(ui: UiStore, key: KeyEvent): void {
  const flow = ui.state.llmSignIn
  if (!flow) return
  if (key.name === "escape") { cancelLlmSignIn(); return }
  if (!flow.paste) return
  if (key.name === "return" || key.name === "enter") { submitSignInPaste(ui); return }
  const next = editText({ value: flow.paste.value, caret: flow.paste.caret }, key)
  if (next) ui.setState("llmSignIn", "paste", { value: next.value, caret: next.caret })
}

export const aiScopes = {
  "modelPicker": {
    handle: handleModelPicker,
    list: false,
    hints: () => [{ key: "type", desc: "filter" }, { key: "↑↓", desc: "move" }, { key: "enter", desc: "use it" }, { key: "esc", desc: "leave it" }],
  },
  "settings.aiUse": {
    handle: handleAiUse,
    list: false,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "do" }, { key: "esc", desc: "close" }],
  },
  "settings.aiSent": {
    handle: handleAiSent,
    list: false,
    hints: () => [{ key: "j/k", desc: "scroll" }, { key: "esc", desc: "back" }],
  },
  "settings.aiDialog": {
    handle: handleAiDialog,
    list: false,
    hints: (state) => state?.aiField ? [{ key: "enter", desc: "save" }, { key: "esc", desc: "back" }] : [{ key: "j/k", desc: "move" }, { key: "enter", desc: "do" }, { key: "esc", desc: "close" }],
  },
  "settings.executor": {
    handle: (ui, key) => handleExecutor(ui, key),
    list: false,
    hints: (state) => state?.executorWaiting ? [{ key: "esc", desc: "cancel" }] : [{ key: "j/k", desc: "move" }, { key: "enter", desc: "do" }, { key: "esc", desc: "close" }],
  },
  "llmSignIn": {
    handle: (ui, key) => handleLlmSignIn(ui, key),
    list: false,
    hints: (state) => [...(state?.signInPaste ? [{ key: "enter", desc: "send" }] : []), { key: "esc", desc: "cancel" }],
  },
  "settings.ai": {
    handle: handleSettingsAi,
    list: true,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "open" }, { key: "esc", desc: "done" }],
  },
} satisfies Partial<Record<ScopeId, ScopeEntry>>

