import { settleData } from "../actions"
import { type KeyEvent } from "@opentui/core"
import { resolve } from "node:path"
import { runSync } from "../sync"
import { openWelcome } from "../welcome"
import { newSuggestionsNote, suggestNew } from "../suggest"
import { IMPORT_HISTORY_ROWS } from "../../state/databaseRows"
import { type ScopeId, type UiStore } from "../../state/uiStore"
import type { DataStore } from "../../state/dataStore"
import { editText } from "../../domain/textField"
import { nextSettingsId } from "../../state/settingsConfig"
import { listMove, confirmTwice, type ScopeEntry } from "./shared"
import { openAiDialog } from "./ai"

function defaultProfile(id: string, path: string) {
  const name = path.split(/[\\/]/).pop()?.replace(/\.csv$/i, "") || "CSV import"
  return { id, name, account: "", accountType: "debit" as const, importPrefix: name.toLowerCase(), hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" as const }
}

function handleSettingsImportFiles(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const wizard = ui.state.importWizard
  if (!wizard) return
  const opened = ui.opening("importWizard")
  const stage = wizard.stage
  const current = () => opened.open && ui.state.importWizard?.stage === stage
  const { name } = key
  const files = wizard.files
  if (name === "escape") { ui.cancelImport(); ui.setStatus("Import cancelled"); return }
  const moved = listMove(key, wizard.cursor, files.length)
  if (moved != null) { opened.patch({ cursor: moved }); return }
  if (name === "/" || name === "p") { opened.patch({ stage: "path", path: "", pathCaret: 0 }); return }
  if ((name === "return" || name === "enter") && files[wizard.cursor]) {
    const path = files[wizard.cursor]!
    const matches = data?.profileMatches(path) ?? []
    if (matches.length === 1) { settleData(ui, (async () => { const preview = await data?.previewImport(path, matches[0]!); if (current()) opened.patch({ stage: "preview", path, pathCaret: path.length, preview: preview ?? null }) })()) }
    else opened.patch({ stage: "profile", path, pathCaret: path.length, profileCursor: 0 })
    return
  }
}

function handleSettingsImportPath(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const wizard = ui.state.importWizard
  if (!wizard) return
  const opened = ui.opening("importWizard")
  const stage = wizard.stage
  const current = () => opened.open && ui.state.importWizard?.stage === stage
  const { name } = key
  if (name === "escape") { opened.patch({ stage: "files", path: "", pathCaret: 0 }); return }
  if (name === "return" || name === "enter") {
    const raw = wizard.path.trim()
    if (!raw) { ui.setStatus("Enter a CSV path", true); return }
    const path = resolve(wizard.directory, raw)
    settleData(ui, (async () => {
      const matches = data?.profileMatches(path) ?? []
      if (matches.length === 1) {
        const preview = await data?.previewImport(path, matches[0]!) ?? null
        if (current()) opened.patch({ stage: "preview", path, pathCaret: path.length, preview })
      }
      else opened.patch({ stage: "profile", path, pathCaret: path.length, profileCursor: 0 })
    })())
    return
  }
  const next = editText({ value: wizard.path, caret: wizard.pathCaret }, key)
  if (next) opened.patch({ path: next.value, pathCaret: next.caret })
}

function handleSettingsImportProfile(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const wizard = ui.state.importWizard
  if (!wizard) return
  const opened = ui.opening("importWizard")
  const stage = wizard.stage
  const current = () => opened.open && ui.state.importWizard?.stage === stage
  const { name } = key
  const profiles = data?.state.importProfiles ?? []
  if (name === "escape") { if (wizard.managing) opened.close(); else opened.patch({ stage: "files", managing: false }); return }
  const moved = listMove(key, wizard.profileCursor, profiles.length + 1)
  if (moved != null) { opened.patch({ profileCursor: moved }); return }
  if (name === "a" || name === "n" || (name === "return" || name === "enter") && wizard.profileCursor === profiles.length) { ui.openProfileEditor(defaultProfile(nextSettingsId("profile", profiles), wizard.path), null); return }
  if (name === "e" && profiles[wizard.profileCursor]) { ui.openProfileEditor(profiles[wizard.profileCursor]!, profiles[wizard.profileCursor]!.id); return }
  if (name === "delete" && profiles[wizard.profileCursor]) { const selected = profiles[wizard.profileCursor]!; confirmTwice(ui, data, { kind: "profile", id: selected.id, label: selected.name, with: "delete" }); return }
  if ((name === "return" || name === "enter") && profiles[wizard.profileCursor]) {
    if (wizard.managing) { ui.openProfileEditor(profiles[wizard.profileCursor]!, profiles[wizard.profileCursor]!.id); return }
    settleData(ui, (async () => {
      const preview = await data?.previewImport(wizard.path, profiles[wizard.profileCursor]!) ?? null
      if (current()) opened.patch({ stage: "preview", preview })
    })())
    return
  }
}

function handleSettingsImportProfileEditor(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const wizard = ui.state.importWizard
  if (!wizard) return
  const opened = ui.opening("importWizard")
  const stage = wizard.stage
  const current = () => opened.open && ui.state.importWizard?.stage === stage
  const { name } = key
  const draft = wizard.profileDraft, field = wizard.profileField
  const fields = ["id", "name", "account", "accountType", "importPrefix", "hasHeader", "delimiter", "dateColumn", "amountColumn", "descriptionColumns", "descriptionJoin", "amountStrip", "dateFormat"] as const
  const selected = fields[field]!
  if (name === "escape") { opened.patch({ stage: "profile" }); return }
  if (name === "tab") {
    const next = (field + (key.shift ? -1 : 1) + fields.length) % fields.length
    const selected = fields[next]!
    const value = selected === "descriptionColumns" ? draft.descriptionColumns.join(",") : String(draft[selected])
    opened.patch({ profileField: next, profileCaret: value.length })
    return
  }
  if (name === "return" || name === "enter") {
    settleData(ui, (async () => {
      const { path, profileEditId } = wizard
      await data?.saveImportProfile(draft, profileEditId)
      if (!current()) return
      const preview = path ? await data?.previewImport(path, draft) : null
      if (!current()) return
      opened.patch({ stage: preview ? "preview" : "profile", preview: preview ?? null, profileEditId: null })
      ui.setStatus(`Saved profile ${draft.name}`)
    })())
    return
  }
  if (selected === "accountType" && (name === "h" || name === "left" || name === "l" || name === "right" || name === "space")) { ui.setState("importWizard", "profileDraft", "accountType", draft.accountType === "debit" ? "credit" : "debit"); return }
  if ((selected === "hasHeader" || selected === "descriptionJoin") && (name === "h" || name === "left" || name === "l" || name === "right" || name === "space")) { ui.setState("importWizard", "profileDraft", selected, !draft[selected]); return }
  if (selected === "dateFormat" && (name === "h" || name === "left" || name === "l" || name === "right" || name === "space")) { const values = ["DMY", "MDY", "YMD"] as const; ui.setState("importWizard", "profileDraft", "dateFormat", values[(values.indexOf(draft.dateFormat) + 1) % values.length]!); return }
  if (selected === "accountType" || selected === "hasHeader" || selected === "descriptionJoin" || selected === "dateFormat") return
  const text = selected === "descriptionColumns" ? draft.descriptionColumns.join(",") : String(draft[selected])
  const next = editText({ value: text, caret: wizard.profileCaret }, key)
  if (next) {
    opened.patch({ profileCaret: next.caret })
    if (selected === "descriptionColumns") ui.setState("importWizard", "profileDraft", selected, next.value ? next.value.split(",").map(Number).filter(Number.isInteger) : [])
    else if (selected === "dateColumn" || selected === "amountColumn") ui.setState("importWizard", "profileDraft", selected, Number(next.value || 0))
    else ui.setState("importWizard", "profileDraft", selected, next.value)
  }
}

function handleSettingsImportPreview(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const wizard = ui.state.importWizard
  if (!wizard) return
  const opened = ui.opening("importWizard")
  const { name } = key
  if (wizard.committing && ["s", "a", "r", "p", "escape"].includes(key.name)) return
  const preview = wizard.preview
  const rows = preview ? (wizard.previewShowAll ? preview.rows : preview.rows.filter((row) => row.duplicate)) : []
  if (name === "escape") { ui.cancelImport(); ui.setStatus("Import cancelled"); return }
  const moved = listMove(key, wizard.previewCursor, rows.length)
  if (moved != null) { opened.patch({ previewCursor: moved }); return }
  if (name === "p") { opened.patch({ previewShowAll: !wizard.previewShowAll, previewCursor: 0 }); return }
  if (name === "r") { opened.patch({ previewRules: !wizard.previewRules }); return }
  if ((name === "s" || name === "a") && preview) {
    opened.patch({ committing: true })
    const rulesEnabled = wizard.previewRules
    settleData(ui, (async () => {
      let summary: string
      try {
        summary = await data?.commitPreview({ ...preview, rulesEnabled }, name === "s") ?? "Import unavailable"
      } catch (error) { opened.patch({ committing: false }); throw error }
      opened.close()
      ui.setStatus(summary)
      if (data) settleData(ui, suggestNew(data), (n) => { if (n) ui.setStatus(summary + newSuggestionsNote(n)) })
    })())
    return
  }
}

export const UP_ROWS = ["token", "sync", "accounts", "setup"] as const

function handleSettingsUp(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const { name } = key
  if (name === "escape") { ui.leaveSettings(); return }
  const moved = listMove(key, ui.state.upCursor, UP_ROWS.length)
  if (moved != null) { ui.setState({ upCursor: moved }); return }
  if (name === "return" || name === "enter") {
    const row = UP_ROWS[Math.min(ui.state.upCursor, UP_ROWS.length - 1)]
    if (row === "token") openAiDialog(ui, "up")
    else if (row === "sync" && data) void runSync(ui, data, { manual: true })
    else if (row === "accounts") ui.setState({ upAccounts: { cursor: 0 } })
    else if (row === "setup") openWelcome(ui)
    return
  }
  if (name === "s" && data) { void runSync(ui, data, { manual: true }); return }
}

function handleImportHistory(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  if (key.name === "escape") { ui.setState({ importHistory: null }); return }
  const count = data?.state.imports.length ?? 0
  const moved = listMove(key, ui.state.importHistory?.top ?? 0, Math.max(1, count - IMPORT_HISTORY_ROWS + 1), IMPORT_HISTORY_ROWS)
  if (moved != null) ui.setState("importHistory", { top: moved })
}

function handleUpAccounts(ui: UiStore, key: KeyEvent, data?: DataStore): void {
  const dialog = ui.state.upAccounts
  if (!dialog) return
  const { name } = key
  const accounts = data?.state.syncAccounts ?? []
  if (name === "escape") { ui.disarm(); ui.setState({ upAccounts: null }); return }
  const moved = listMove(key, dialog.cursor, accounts.length)
  if (moved != null) { ui.setState("upAccounts", { cursor: moved }); return }
  const account = accounts[dialog.cursor]
  if ((name === "return" || name === "enter") && account && data) {
    if (account.syncEnabled) { confirmTwice(ui, data, { kind: "desyncAccount", id: account.id, label: account.name, with: "enter" }); return }
    settleData(ui, (async () => { await data.setAccountSync(account.id, true); ui.setStatus(`Sync on for ${account.name} · s to sync now`) })())
    return
  }
  if (name === "s" && data) { void runSync(ui, data, { manual: true }); return }
}

export const settingsImportScopes = {
  "settings.upAccounts": {
    handle: handleUpAccounts,
    list: false,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "sync on/off" }, { key: "s", desc: "sync now" }, { key: "esc", desc: "close" }],
  },
  "settings.import.files": {
    handle: handleSettingsImportFiles,
    list: false,
    hints: () => [{ key: "j/k", desc: "file" }, { key: "enter", desc: "select" }, { key: "p", desc: "path" }, { key: "esc", desc: "cancel" }],
  },
  "settings.import.path": {
    handle: handleSettingsImportPath,
    list: false,
    hints: () => [{ key: "enter", desc: "open" }, { key: "esc", desc: "back" }, { key: "type", desc: "path" }],
  },
  "settings.import.profile": {
    handle: handleSettingsImportProfile,
    list: false,
    hints: () => [{ key: "j/k", desc: "profile" }, { key: "enter", desc: "select" }, { key: "a/e", desc: "new/edit" }, { key: "del del", desc: "delete" }, { key: "esc", desc: "back" }],
  },
  "settings.import.profileEditor": {
    handle: handleSettingsImportProfileEditor,
    list: false,
    hints: () => [{ key: "tab", desc: "field" }, { key: "h/l", desc: "choice" }, { key: "enter", desc: "save" }, { key: "esc", desc: "back" }],
  },
  "settings.import.preview": {
    handle: handleSettingsImportPreview,
    list: false,
    hints: () => [{ key: "s", desc: "skip dupes" }, { key: "a", desc: "force import" }, { key: "p", desc: "all/dupes" }, { key: "r", desc: "rules" }, { key: "esc", desc: "cancel" }],
  },
  "settings.up": {
    handle: handleSettingsUp,
    list: true,
    hints: () => [{ key: "j/k", desc: "move" }, { key: "enter", desc: "open" }, { key: "s", desc: "sync now" }, { key: "esc", desc: "done" }],
  },
  "settings.importHistory": {
    handle: handleImportHistory,
    list: true,
    hints: () => [{ key: "j/k", desc: "scroll" }, { key: "esc", desc: "close" }],
  },
} satisfies Partial<Record<ScopeId, ScopeEntry>>

