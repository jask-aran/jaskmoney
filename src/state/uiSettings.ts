import type { SetStoreFunction } from "solid-js/store"
import type { SettingsEditorKind, UiState } from "./uiStore"
import type { Armed } from "./armed"
import type { ImportProfile } from "../domain/types"
import { editorFields } from "./settingsForm"
import { settingsSectionFocus } from "./uiTables"

type SettingsList = UiState["taxonomyList"]

export function createSettingsActions(state: UiState, setState: SetStoreFunction<UiState>, setStatus: (text: string, isErr?: boolean) => number) {
  function activateSettings(section: UiState["settingsSection"], list: SettingsList = "categories", reset = false) {
    const updates: Partial<UiState> = { settingsActive: true, settingsSection: section, taxonomyList: list, focusedSection: settingsSectionFocus(section, list), jump: null }
    if (reset && list === "categories") updates.categoryCursor = 0
    if (reset && list === "tags") updates.tagCursor = 0
    setState(updates)
  }

  function leaveSettings() {
    setState({ settingsActive: false, settingsEditor: null, armed: null, importWizard: null })
    setStatus("Settings · navigate sections")
  }
  function openSettingsEditor(kind: SettingsEditorKind, id: number | string | null, draft: UiState["settingsDraft"]) {
    const field = editorFields(kind, draft, { accounts: [], categories: [], tags: [], savedFilters: [] })[0]
    setState({ settingsEditor: { kind, id, field: 0, picker: null, caret: field?.kind === "text" ? field.display.length : 0, saving: false }, settingsDraft: draft, armed: null, jump: null })
  }
  function closeSettingsEditor() { setState({ settingsEditor: null }) }
  function arm(armed: Armed) { setState({ armed }) }
  function disarm() { if (state.armed) setState({ armed: null }) }

  function beginImport(directory: string, files: string[]) {
    setState({ importWizard: { stage: "files", directory, files, cursor: 0, path: "", pathCaret: 0, profileCursor: 0, managing: false, profileDraft: { id: "", name: "", account: "", accountType: "debit", importPrefix: "", hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" }, profileEditId: null, profileField: 0, profileCaret: 0, preview: null, previewCursor: 0, previewShowAll: false, previewRules: true, committing: false }, jump: null })
  }
  function cancelImport() { setState({ importWizard: null }) }
  function openProfileEditor(draft: ImportProfile, id: string | null) { if (!state.importWizard) beginImport("", []); setState("importWizard", { stage: "profileEditor", profileDraft: draft, profileEditId: id, profileField: 0, profileCaret: draft.id.length }) }

  return { activateSettings, leaveSettings, openSettingsEditor, closeSettingsEditor, arm, disarm, beginImport, cancelImport, openProfileEditor }
}
