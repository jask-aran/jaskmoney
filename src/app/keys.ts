import type { KeyEvent } from "@opentui/core"
import { resolve } from "node:path"
import { accountRole } from "../domain/types"
import { selectableEntries, spendingScope, type AccountSelection } from "../domain/accountTree"
import { assignableCategories } from "../domain/categoryOptions"
import { budgetLabel, budgetScopeOptions, scopeKey } from "../domain/budgetScopes"
import type { CycleConfig } from "../domain/budget"
import { MERCHANT_SORTS, groupByMerchant, merchantFilter, sortMerchantGroups } from "../domain/merchants"
import { editorFields, pickerChoices, pickerItems, stepChoice } from "../state/settingsForm"
import { runSync } from "./sync"
import { CHART_VIEWS, JUMP_TARGETS, SETTINGS_SECTIONS, TABS, settingsSectionFocus, type ScopeId, type UiStore } from "../state/uiStore"
import type { DataStore } from "../state/dataStore"
import {
  LOOKBACKS,
  PERIOD_LABEL,
  activeChipIndex,
  applyChip,
  chipCount,
  dataClock,
  stepPeriod,
  timeframeBounds,
} from "../domain/timeframe"

function isPrintable(key: KeyEvent): boolean {
  if (key.ctrl || key.meta) return false
  const s = key.sequence
  if (!s || s.length !== 1) return false
  const code = s.charCodeAt(0)
  return code >= 32 && code !== 127
}

function defaultProfile(id: string, path: string) {
  const name = path.split(/[\\/]/).pop()?.replace(/\.csv$/i, "") || "CSV import"
  return { id, name, account: "", accountType: "debit" as const, importPrefix: name.toLowerCase(), hasHeader: true, delimiter: ",", dateColumn: 0, amountColumn: 1, descriptionColumns: [2], descriptionJoin: false, amountStrip: "$", dateFormat: "DMY" as const }
}

function moveTxnCursor(
  ui: UiStore,
  data: DataStore | undefined,
  delta: number,
  withRange: boolean,
) {
  const rows = data?.scopedTransactions() ?? []
  if (rows.length === 0) return
  const prev = rows[ui.state.managerCursor]
  ui.moveManagerCursor(delta, rows.length)
  const cur = rows[ui.state.managerCursor]
  if (!cur) return
  if (withRange) {
    const anchorId =
      ui.state.rangeSelecting && ui.state.rangeAnchorId
        ? ui.state.rangeAnchorId
        : (prev?.id ?? cur.id)
    ui.setRangeFromMove(anchorId, cur.id, true)
  } else if (ui.state.rangeSelecting) {
    ui.setRangeFromMove(0, 0, false)
  }
}

export function handleKey(ui: UiStore, key: KeyEvent, data?: DataStore): boolean {
  const name = key.name
  const seq = key.sequence

  if (key.ctrl && name === "c") return false
  // Sync from anywhere, including over overlays: it changes no UI state.
  if (key.ctrl && name === "r") {
    if (data) void runSync(ui, data, { manual: true })
    return true
  }

  // ── Jump ────────────────────────────────────────────────────────────
  if (ui.state.jumpMode) {
    if (name === "escape" || name === "v") {
      ui.cancelJump()
      return true
    }
    const hit = JUMP_TARGETS[ui.state.activeTab].find(
      (t) => t.key === name || t.key === seq,
    )
    if (hit) {
      if (ui.state.activeTab === "settings") {
        if (hit.section === "set.categories") ui.activateSettings("taxonomy", "categories", true)
        else if (hit.section === "set.tags") ui.activateSettings("taxonomy", "tags", true)
        else if (hit.section === "set.rules") ui.activateSettings("rules")
        else if (hit.section === "set.filters") ui.activateSettings("filters")
        else if (hit.section === "set.database") ui.activateSettings("database")
        else if (hit.section === "set.up") ui.activateSettings("up")
        else if (hit.section === "set.budgets") ui.activateSettings("budgets")
        return true
      }
      ui.applyJump(hit.section)
      return true
    }
    return true
  }


  // ── Tag picker ──────────────────────────────────────────────────────
  if (ui.state.tagPickerOpen) {
    const q = ui.state.tagPickerQuery.trim().toLowerCase()
    const tags = (data?.state.tags ?? []).filter(
      (tg) => !q || tg.name.toLowerCase().includes(q),
    )
    if (name === "escape") {
      ui.closeTagPicker()
      ui.setStatus("Tags cancelled")
      return true
    }
    if (name === "j" || name === "down") {
      if (tags.length)
        ui.setState({
          tagPickerCursor: Math.min(tags.length - 1, ui.state.tagPickerCursor + 1),
        })
      return true
    }
    if (name === "k" || name === "up") {
      ui.setState({ tagPickerCursor: Math.max(0, ui.state.tagPickerCursor - 1) })
      return true
    }
    if (name === "space" || seq === " ") {
      const tag = tags[ui.state.tagPickerCursor]
      const targets = ui.state.pickerTargets
      if (tag && data && targets.length) {
        data.toggleTagOnTransactions(targets, tag.id).then(
          (summary) => ui.setStatus(summary, summary.includes(" failed: ")),
          (error) => ui.setStatus(error instanceof Error ? error.message : String(error), true),
        )
      }
      return true
    }
    if (name === "return" || name === "enter") {
      ui.closeTagPicker()
      ui.setStatus("Tags applied")
      return true
    }
    if (name === "backspace") {
      ui.setState({
        tagPickerQuery: ui.state.tagPickerQuery.slice(0, -1),
        tagPickerCursor: 0,
      })
      return true
    }
    if (isPrintable(key)) {
      ui.setState({
        tagPickerQuery: ui.state.tagPickerQuery + seq,
        tagPickerCursor: 0,
      })
      return true
    }
    return true
  }

  // ── Cat picker ──────────────────────────────────────────────────────
  if (ui.state.catPickerOpen) {
    const cats = assignableCategories(data?.state.categories ?? [], ui.state.catPickerQuery)
    if (name === "escape") {
      ui.closeCatPicker()
      ui.setStatus("Categorize cancelled")
      return true
    }
    if (name === "j" || name === "down") {
      const n = cats.length
      if (n > 0) {
        ui.setState({
          catPickerCursor: Math.min(n - 1, ui.state.catPickerCursor + 1),
        })
      }
      return true
    }
    if (name === "k" || name === "up") {
      ui.setState({
        catPickerCursor: Math.max(0, ui.state.catPickerCursor - 1),
      })
      return true
    }
    if (name === "return" || name === "enter") {
      const cat = cats[ui.state.catPickerCursor]
      // Targets were fixed when the picker opened (Manager selection, the
      // open detail row, or the Recent cursor).
      const targets = ui.state.pickerTargets
      if (cat && data && targets.length) {
        ui.closeCatPicker()
        ui.setStatus(`Categorizing ${targets.length} → ${cat.name}…`)
        data.categorizeTransactions(targets, cat.id).then(
          (summary) => ui.setStatus(summary, summary.includes(" failed: ")),
          (error) => ui.setStatus(error instanceof Error ? error.message : String(error), true),
        )
      } else {
        ui.closeCatPicker()
        ui.setStatus("Nothing to categorize", true)
      }
      return true
    }
    if (name === "backspace") {
      ui.setState({
        catPickerQuery: ui.state.catPickerQuery.slice(0, -1),
        catPickerCursor: 0,
      })
      return true
    }
    if (isPrintable(key)) {
      ui.setState({
        catPickerQuery: ui.state.catPickerQuery + seq,
        catPickerCursor: 0,
      })
      return true
    }
    return true
  }

  // ── Filter input (live parse every keystroke) ───────────────────────
  if (ui.state.filterMode) {
    if (name === "escape") {
      ui.closeFilter(false)
      data?.clearFilter()
      ui.jumpManagerCursor(0, data?.scopedTransactions().length ?? 0)
      ui.setStatus("Filter cleared")
      return true
    }
    if (name === "return" || name === "enter") {
      const draft = ui.state.filterDraft
      ui.closeFilter(true)
      const r = data?.commitFilter(draft) ?? { ok: true, err: "" }
      ui.jumpManagerCursor(0, data?.scopedTransactions().length ?? 0)
      if (!draft.trim()) {
        ui.setStatus("Filter cleared")
      } else if (r.ok) {
        ui.setStatus(`Filter ok · ${data?.scopedTransactions().length ?? 0} rows`)
      } else {
        ui.setStatus(`Filter live (not strict): ${r.err}`, true)
      }
      return true
    }
    if (name === "backspace") {
      const next = ui.state.filterDraft.slice(0, -1)
      ui.setState({ filterDraft: next })
      data?.setFilterLive(next)
      ui.jumpManagerCursor(0, data?.scopedTransactions().length ?? 0)
      return true
    }
    if (isPrintable(key)) {
      const next = ui.state.filterDraft + seq
      ui.setState({ filterDraft: next })
      data?.setFilterLive(next)
      ui.jumpManagerCursor(0, data?.scopedTransactions().length ?? 0)
      return true
    }
    return true
  }

  // ── Transaction detail (a modal: owns input until closed) ──────────
  if (ui.state.detailId != null) {
    if (ui.state.detailNotesEditing) {
      if (name === "escape") { ui.setState({ detailNotesEditing: false, detailNotesDraft: "" }); ui.setStatus("Notes unchanged"); return true }
      if (name === "return" || name === "enter") {
        try { data?.updateTransactionNotes(ui.state.detailId, ui.state.detailNotesDraft.trim()); ui.setStatus("Notes saved") } catch (e) { ui.setStatus(e instanceof Error ? e.message : String(e), true) }
        ui.setState({ detailNotesEditing: false, detailNotesDraft: "" })
        return true
      }
      if (name === "backspace") { ui.setState({ detailNotesDraft: ui.state.detailNotesDraft.slice(0, -1) }); return true }
      if (isPrintable(key)) { ui.setState({ detailNotesDraft: ui.state.detailNotesDraft + seq }); return true }
      return true
    }
    if (name === "escape" || name === "return" || name === "enter") { ui.setState({ detailId: null }); return true }
    if (name === "c") { ui.openCatPicker(ui.targetIds(data?.scopedTransactions() ?? [])); return true }
    if (name === "t") { ui.openTagPicker(ui.targetIds(data?.scopedTransactions() ?? [])); return true }
    if (name === "n") {
      const notes = data?.state.transactions.find((t) => t.id === ui.state.detailId)?.notes ?? ""
      ui.setState({ detailNotesEditing: true, detailNotesDraft: notes })
      return true
    }
    // j/k browse neighbouring transactions without closing the view.
    if (name === "j" || name === "down" || name === "k" || name === "up") {
      const rows = data?.scopedTransactions() ?? []
      moveTxnCursor(ui, data, name === "j" || name === "down" ? 1 : -1, false)
      const row = rows[ui.state.managerCursor]
      if (row) ui.setState({ detailId: row.id })
      return true
    }
    return true
  }

  // ── Import and account-data modals own all input ───────────────────
  if (ui.state.factoryResetOpen) {
    if (name === "escape") { ui.setState({ factoryResetOpen: false, factoryResetDraft: "" }); ui.setStatus("Factory reset cancelled"); return true }
    if (name === "backspace") { ui.setState({ factoryResetDraft: ui.state.factoryResetDraft.slice(0, -1) }); return true }
    if (name === "return" || name === "enter") {
      if (ui.state.factoryResetDraft !== "RESET") { ui.setStatus("Type RESET exactly to erase this database", true); return true }
      try { data?.factoryResetDatabase(); ui.setState({ factoryResetOpen: false, factoryResetDraft: "" }); ui.setStatus("Database reset · OpenTUI settings retained") } catch (e) { ui.setStatus(e instanceof Error ? e.message : String(e), true) }
      return true
    }
    if (isPrintable(key)) ui.setState({ factoryResetDraft: ui.state.factoryResetDraft + seq })
    return true
  }

  if (ui.state.accountActionId != null) {
    if (name === "escape") { ui.setState({ accountActionId: null }); ui.setStatus("Account actions cancelled"); return true }
    const account = data?.state.accounts.find((a) => a.id === ui.state.accountActionId)
    if (name === "c" && account) { ui.setState({ accountActionId: null }); ui.armSettingsConfirm({ kind: "clearAccount", id: account.id, label: account.name }); ui.setStatus(`Press del to clear ${account.name}`); return true }
    if ((name === "x" || name === "delete") && account) { ui.setState({ accountActionId: null }); ui.armSettingsConfirm({ kind: "deleteAccount", id: account.id, label: account.name }); ui.setStatus(`Press del to remove ${account.name} and its transactions`); return true }
    return true
  }

  if (ui.state.importStage === "files") {
    const files = ui.state.importFiles
    if (name === "escape") { ui.cancelImport(); ui.setStatus("Import cancelled"); return true }
    if (name === "j" || name === "down") { ui.setState({ importCursor: Math.min(files.length - 1, ui.state.importCursor + 1) }); return true }
    if (name === "k" || name === "up") { ui.setState({ importCursor: Math.max(0, ui.state.importCursor - 1) }); return true }
    if (name === "/" || name === "p") { ui.setState({ importStage: "path", importPath: "" }); return true }
    if ((name === "return" || name === "enter") && files[ui.state.importCursor]) {
      const path = files[ui.state.importCursor]!
      const matches = data?.profileMatches(path) ?? []
      if (matches.length === 1) { try { const preview = data?.previewImport(path, matches[0]!); ui.setState({ importStage: "preview", importPath: path, importPreview: preview ?? null }) } catch (e) { ui.setStatus(e instanceof Error ? e.message : String(e), true) } }
      else ui.setState({ importStage: "profile", importPath: path, importProfileCursor: 0 })
      return true
    }
    return true
  }

  if (ui.state.importStage === "path") {
    if (name === "escape") { ui.setState({ importStage: "files", importPath: "" }); return true }
    if (name === "backspace") { ui.setState({ importPath: ui.state.importPath.slice(0, -1) }); return true }
    if (name === "return" || name === "enter") {
      const raw = ui.state.importPath.trim()
      if (!raw) { ui.setStatus("Enter a CSV path", true); return true }
      const path = resolve(ui.state.importDirectory, raw)
      try {
        const matches = data?.profileMatches(path) ?? []
        if (matches.length === 1) ui.setState({ importStage: "preview", importPath: path, importPreview: data?.previewImport(path, matches[0]!) ?? null })
        else ui.setState({ importStage: "profile", importPath: path, importProfileCursor: 0 })
      } catch (e) { ui.setStatus(e instanceof Error ? e.message : String(e), true) }
      return true
    }
    if (isPrintable(key)) ui.setState({ importPath: ui.state.importPath + seq })
    return true
  }

  if (ui.state.importStage === "profile") {
    const profiles = data?.state.importProfiles ?? []
    if (name === "escape") { ui.setState({ importStage: ui.state.importProfileManaging ? "none" : "files", importProfileManaging: false }); return true }
    if (name === "j" || name === "down") { ui.setState({ importProfileCursor: Math.min(profiles.length, ui.state.importProfileCursor + 1) }); return true }
    if (name === "k" || name === "up") { ui.setState({ importProfileCursor: Math.max(0, ui.state.importProfileCursor - 1) }); return true }
    if (name === "a" || name === "n" || (name === "return" || name === "enter") && ui.state.importProfileCursor === profiles.length) { ui.openProfileEditor(defaultProfile(`profile-${profiles.length + 1}`, ui.state.importPath), null); return true }
    if (name === "e" && profiles[ui.state.importProfileCursor]) { ui.openProfileEditor(profiles[ui.state.importProfileCursor]!, profiles[ui.state.importProfileCursor]!.id); return true }
    if (name === "delete" && profiles[ui.state.importProfileCursor]) { const selected = profiles[ui.state.importProfileCursor]!; ui.armSettingsConfirm({ kind: "profile", id: selected.id, label: selected.name }); ui.setStatus(`Press del again to delete profile ${selected.name}`); return true }
    if ((name === "return" || name === "enter") && profiles[ui.state.importProfileCursor]) {
      if (ui.state.importProfileManaging) { ui.openProfileEditor(profiles[ui.state.importProfileCursor]!, profiles[ui.state.importProfileCursor]!.id); return true }
      try { ui.setState({ importStage: "preview", importPreview: data?.previewImport(ui.state.importPath, profiles[ui.state.importProfileCursor]!) ?? null }) } catch (e) { ui.setStatus(e instanceof Error ? e.message : String(e), true) }
      return true
    }
    return true
  }

  if (ui.state.importStage === "profileEditor") {
    const draft = ui.state.importProfileDraft, field = ui.state.importProfileField
    const fields = ["id", "name", "account", "accountType", "importPrefix", "hasHeader", "delimiter", "dateColumn", "amountColumn", "descriptionColumns", "descriptionJoin", "amountStrip", "dateFormat"] as const
    const selected = fields[field]!
    if (name === "escape") { ui.setState({ importStage: "profile" }); return true }
    if (name === "tab") { ui.setState({ importProfileField: (field + (key.shift ? -1 : 1) + fields.length) % fields.length }); return true }
    if (name === "return" || name === "enter") {
      try {
        data?.saveImportProfile(draft)
        const preview = ui.state.importPath ? data?.previewImport(ui.state.importPath, draft) : null
        ui.setState({ importStage: preview ? "preview" : "profile", importPreview: preview ?? null, importProfileEditId: null })
        ui.setStatus(`Saved profile ${draft.name}`)
      } catch (e) { ui.setStatus(e instanceof Error ? e.message : String(e), true) }
      return true
    }
    if (selected === "accountType" && (name === "h" || name === "left" || name === "l" || name === "right" || name === "space")) { ui.setState("importProfileDraft", "accountType", draft.accountType === "debit" ? "credit" : "debit"); return true }
    if ((selected === "hasHeader" || selected === "descriptionJoin") && (name === "h" || name === "left" || name === "l" || name === "right" || name === "space")) { ui.setState("importProfileDraft", selected, !draft[selected]); return true }
    if (selected === "dateFormat" && (name === "h" || name === "left" || name === "l" || name === "right" || name === "space")) { const values = ["DMY", "MDY", "YMD"] as const; ui.setState("importProfileDraft", "dateFormat", values[(values.indexOf(draft.dateFormat) + 1) % values.length]!); return true }
    const text = selected === "descriptionColumns" ? draft.descriptionColumns.join(",") : String(draft[selected])
    if (name === "backspace") {
      const next = text.slice(0, -1)
      if (selected === "descriptionColumns") ui.setState("importProfileDraft", "descriptionColumns", next ? next.split(",").map(Number).filter(Number.isInteger) : [])
      else if (["dateColumn", "amountColumn"].includes(selected)) ui.setState("importProfileDraft", selected as "dateColumn", Number(next || 0))
      else ui.setState("importProfileDraft", selected as "id", next as never)
      return true
    }
    if (isPrintable(key) && !["accountType", "hasHeader", "descriptionJoin", "dateFormat"].includes(selected)) {
      const next = text + seq
      if (selected === "descriptionColumns") ui.setState("importProfileDraft", "descriptionColumns", next.split(",").map(Number).filter(Number.isInteger))
      else if (["dateColumn", "amountColumn"].includes(selected)) ui.setState("importProfileDraft", selected as "dateColumn", Number(next || 0))
      else ui.setState("importProfileDraft", selected as "id", next as never)
    }
    return true
  }

  if (ui.state.importStage === "preview") {
    const preview = ui.state.importPreview
    const rows = preview ? (ui.state.importPreviewShowAll ? preview.rows : preview.rows.filter((row) => row.duplicate)) : []
    if (name === "escape") { ui.cancelImport(); ui.setStatus("Import cancelled"); return true }
    if (name === "j" || name === "down") { ui.setState({ importPreviewCursor: Math.min(Math.max(0, rows.length - 1), ui.state.importPreviewCursor + 1) }); return true }
    if (name === "k" || name === "up") { ui.setState({ importPreviewCursor: Math.max(0, ui.state.importPreviewCursor - 1) }); return true }
    if (name === "p") { ui.setState({ importPreviewShowAll: !ui.state.importPreviewShowAll, importPreviewCursor: 0, importPreviewTop: 0 }); return true }
    if (name === "r") { ui.setState({ importPreviewRules: !ui.state.importPreviewRules }); return true }
    if ((name === "s" || name === "a") && preview) {
      try { const summary = data?.commitPreview({ ...preview, rulesEnabled: ui.state.importPreviewRules }, name === "s") ?? "Import unavailable"; ui.cancelImport(); ui.setStatus(summary) } catch (e) { ui.setStatus(e instanceof Error ? e.message : String(e), true) }
      return true
    }
    return true
  }

  // ── Settings editors and confirmations own every printable key ─────
  if (ui.state.settingsConfirm) {
    if (name === "escape") { ui.clearSettingsConfirm(); ui.setStatus("Action cancelled"); return true }
    const confirm = ui.state.settingsConfirm
    const matches = name === "delete" || name === "backspace"
    if (matches) {
      try {
        if (confirm.kind === "category") data?.deleteSettingsCategory(Number(confirm.id))
        if (confirm.kind === "tag") data?.deleteSettingsTag(Number(confirm.id))
        if (confirm.kind === "rule") data?.deleteSettingsRule(Number(confirm.id))
        if (confirm.kind === "filter") data?.deleteSavedFilter(String(confirm.id))
        if (confirm.kind === "profile") data?.deleteImportProfile(String(confirm.id))
        if (confirm.kind === "clearData") data?.clearDatabaseData()
        if (confirm.kind === "clearAccount") data?.clearAccountData(Number(confirm.id))
        if (confirm.kind === "deleteAccount") data?.removeAccountData(Number(confirm.id))
        if (confirm.kind === "budget") data?.removeBudget(Number(confirm.id))
        if (confirm.kind === "desyncAccount") {
          const removed = data?.setAccountSync(Number(confirm.id), false) ?? 0
          ui.clearSettingsConfirm(); ui.setStatus(`Sync off for ${confirm.label} · ${removed} transactions removed`)
          return true
        }
        ui.clearSettingsConfirm(); ui.setStatus(confirm.kind === "clearData" ? "Transaction and import data cleared" : confirm.kind === "clearAccount" ? `Cleared ${confirm.label}` : confirm.kind === "deleteAccount" ? `Removed ${confirm.label}` : `Deleted ${confirm.label}`)
      } catch (e) { ui.clearSettingsConfirm(); ui.setStatus(e instanceof Error ? e.message : String(e), true) }
      return true
    }
    return true
  }

  if (ui.state.settingsEditor) {
    const kind = ui.state.settingsEditor
    const draft = ui.state.settingsDraft
    const ctx = { accounts: data?.state.accounts ?? [], categories: data?.state.categories ?? [], tags: data?.state.tags ?? [], savedFilters: data?.state.savedFilters ?? [] }
    const fields = editorFields(kind, draft, ctx)
    const fieldIndex = Math.min(ui.state.settingsEditField, fields.length - 1)
    const field = fields[fieldIndex]!

    // A picker field's list owns input until it closes (like the category
    // picker: j/k and arrows move, other printable keys filter).
    const picker = ui.state.formPicker
    if (picker) {
      const choices = pickerChoices(pickerItems(kind, field.key, ctx, picker.query))
      if (name === "escape") { ui.setState({ formPicker: null }); return true }
      if (name === "j" || name === "down") { ui.setState("formPicker", "cursor", Math.min(Math.max(0, choices.length - 1), picker.cursor + 1)); return true }
      if (name === "k" || name === "up") { ui.setState("formPicker", "cursor", Math.max(0, picker.cursor - 1)); return true }
      if (name === "return" || name === "enter") {
        const choice = choices[picker.cursor]
        if (!choice) return true
        if (field.multi) {
          // Multi-choice (rule tags): enter toggles; esc closes.
          const id = Number(choice.value)
          ui.setState("settingsDraft", "addTagIds", draft.addTagIds.includes(id) ? draft.addTagIds.filter((t) => t !== id) : [...draft.addTagIds, id])
          return true
        }
        ui.setState("settingsDraft", field.key as "scopeKey", choice.value as never)
        ui.setState({ formPicker: null })
        return true
      }
      if (name === "backspace") { ui.setState({ formPicker: { query: picker.query.slice(0, -1), cursor: 0 } }); return true }
      if (isPrintable(key)) { ui.setState({ formPicker: { query: picker.query + seq, cursor: 0 } }); return true }
      return true
    }

    const isText = field.kind === "text"
    const move = (step: number) => ui.setState({ settingsEditField: (fieldIndex + step + fields.length) % fields.length })
    if (name === "escape") { ui.closeSettingsEditor(); ui.setStatus("Edit cancelled"); return true }
    if (name === "tab") { move(key.shift ? -1 : 1); return true }
    if (name === "down" || (!isText && name === "j")) { move(1); return true }
    if (name === "up" || (!isText && name === "k")) { move(-1); return true }
    if ((name === "return" || name === "enter") && field.kind === "picker") {
      // Open the list on the current value.
      const current = draft[field.key]
      const at = field.multi ? 0 : pickerChoices(pickerItems(kind, field.key, ctx, "")).findIndex((c) => c.value === current)
      ui.setState({ formPicker: { query: "", cursor: Math.max(0, at) } })
      return true
    }
    if (name === "return" || name === "enter") {
      try {
        if (kind === "category") {
          if (ui.state.settingsEditId == null) data?.createSettingsCategory({ name: draft.name, color: draft.color, notSpending: draft.notSpending })
          else data?.updateSettingsCategory(Number(ui.state.settingsEditId), { name: draft.name, color: draft.color, notSpending: draft.notSpending })
        } else if (kind === "tag") {
          if (ui.state.settingsEditId == null) data?.createSettingsTag({ name: draft.name, color: draft.color, categoryId: draft.categoryId })
          else data?.updateSettingsTag(Number(ui.state.settingsEditId), { name: draft.name, color: draft.color, categoryId: draft.categoryId })
        } else if (kind === "budget") {
          const option = budgetScopeOptions(ctx.accounts, ctx.categories).find((o) => o.key === draft.scopeKey)
          const amount = Number(draft.amount.replace(/[$,\s]/g, ""))
          if (!option) throw new Error("choose what the budget covers")
          if (!draft.amount.trim() || !Number.isFinite(amount)) throw new Error("enter the budget amount")
          const cycle = { unit: draft.unit, anchor: draft.anchor, anchorDate: draft.anchor === "calendar" ? null : draft.anchorDate.trim() }
          const current = data?.state.budgetCycle
          // The cycle is shared by every budget; save it first so a bad date
          // stops the whole edit.
          if (current && (current.unit !== cycle.unit || current.anchor !== cycle.anchor || current.anchorDate !== cycle.anchorDate)) data?.setBudgetCycle(cycle)
          const editing = data?.state.budgets.find((b) => b.id === ui.state.settingsEditId)
          if (editing && scopeKey(editing.scope) !== option.key) data?.removeBudget(editing.id)
          data?.setBudget(option.scope, amount)
        } else if (kind === "cycle") {
          data?.setBudgetCycle({ unit: draft.unit, anchor: draft.anchor, anchorDate: draft.anchor === "calendar" ? null : draft.anchorDate.trim() })
        } else if (kind === "filter") {
          data?.saveSavedFilter({ id: draft.id, name: draft.name, expr: draft.expr }, typeof ui.state.settingsEditId === "string" ? ui.state.settingsEditId : undefined)
        } else {
          const existing = data?.state.rules.find((r) => r.id === ui.state.settingsEditId)
          const rule = { id: Number(ui.state.settingsEditId ?? 0), name: draft.name, savedFilterId: draft.savedFilterId, setCategoryId: draft.setCategoryId, addTagIds: draft.addTagIds, enabled: existing?.enabled ?? true, sortOrder: existing?.sortOrder ?? 0 }
          if (ui.state.settingsEditId == null) data?.createSettingsRule(rule)
          else data?.updateSettingsRule(rule)
        }
        ui.closeSettingsEditor(); ui.setStatus("Saved")
      } catch (e) { ui.setStatus(e instanceof Error ? e.message : String(e), true) }
      return true
    }
    const left = name === "left" || (!isText && name === "h")
    const right = name === "right" || (!isText && (name === "l" || name === "space"))
    if ((left || right) && field.kind === "choice" && field.choices) {
      ui.setState("settingsDraft", field.key as "unit", stepChoice(field.choices, draft[field.key] as string, left ? -1 : 1) as never)
      return true
    }
    if ((left || right) && field.kind === "toggle") {
      ui.setState("settingsDraft", field.key as "notSpending", !draft[field.key])
      return true
    }
    if (isText && name === "backspace") { ui.setState("settingsDraft", field.key as "name", (draft[field.key] as string).slice(0, -1)); return true }
    if (isText && isPrintable(key)) { ui.setState("settingsDraft", field.key as "name", (draft[field.key] as string) + seq); return true }
    return true
  }

  // ── Global ──────────────────────────────────────────────────────────
  if (name === "v") {
    if (JUMP_TARGETS[ui.state.activeTab].length) ui.enterJump()
    return true
  }

  for (const t of TABS) {
    if (name === t.hotkey || seq === t.hotkey) {
      ui.switchTab(t.id)
      return true
    }
  }

  if (name === "tab") {
    ui.cycleTab(key.shift ? -1 : 1)
    return true
  }

  const scope: ScopeId = ui.activeScope()
  const rows = data?.scopedTransactions() ?? []
  const accounts = data?.state.accounts ?? []
  const clock = dataClock(data?.state.transactions ?? [])

  // ── Settings ───────────────────────────────────────────────────────
  if (scope === "settings") {
    if (name === "i") {
      try {
        const directory = data?.importDirectory() ?? process.cwd()
        ui.activateSettings("database")
        ui.beginImport(directory, data?.csvFiles(directory) ?? [])
      } catch (e) { ui.setStatus(e instanceof Error ? e.message : String(e), true) }
      return true
    }
    const sections = SETTINGS_SECTIONS
    const current = ui.state.settingsSection
    if (name === "h" || name === "left") { ui.setState({ settingsSection: "taxonomy", focusedSection: "set.categories" }); return true }
    if (name === "l" || name === "right") { ui.setState({ settingsSection: "database", focusedSection: "set.database" }); return true }
    if (name === "j" || name === "down" || name === "k" || name === "up") {
      const delta = name === "j" || name === "down" ? 1 : -1
      const next = sections[(sections.indexOf(current) + delta + sections.length) % sections.length]!
      ui.setState({ settingsSection: next, focusedSection: settingsSectionFocus(next) })
      return true
    }
    if (name === "return" || name === "enter") { ui.activateSettings(current); return true }
    return true
  }

  if (scope === "settings.taxonomy") {
    const list = ui.state.taxonomyList
    const items = list === "categories" ? data?.state.categories ?? [] : data?.state.tags ?? []
    const cursor = list === "categories" ? ui.state.categoryCursor : ui.state.tagCursor
    if (name === "escape") { ui.leaveSettings(); return true }
    if (name === "h" || name === "left" || name === "l" || name === "right") { ui.activateSettings("taxonomy", list === "categories" ? "tags" : "categories"); return true }
    if (name === "j" || name === "down") { ui.moveSettingsList(list, 1, items.length); return true }
    if (name === "k" || name === "up") { ui.moveSettingsList(list, -1, items.length); return true }
    if (name === "g") { ui.moveSettingsList(list, -items.length, items.length); return true }
    if (seq === "G" || (name === "g" && key.shift)) { ui.moveSettingsList(list, items.length, items.length); return true }
    if (name === "pageup") { ui.moveSettingsList(list, -10, items.length); return true }
    if (name === "pagedown") { ui.moveSettingsList(list, 10, items.length); return true }
    if (name === "a") {
      ui.openSettingsEditor(list === "categories" ? "category" : "tag", null, { ...ui.state.settingsDraft, name: "", color: list === "categories" ? "#94e2d5" : "#89b4fa", categoryId: null, notSpending: false })
      return true
    }
    if ((name === "return" || name === "enter") && items[cursor]) {
      const item = items[cursor]!
      ui.openSettingsEditor(list === "categories" ? "category" : "tag", item.id, { ...ui.state.settingsDraft, name: item.name, color: item.color, categoryId: list === "tags" ? ("categoryId" in item ? item.categoryId : null) : null, notSpending: "notSpending" in item ? item.notSpending : false })
      return true
    }
    if (name === "delete" && items[cursor]) { ui.armSettingsConfirm({ kind: list === "categories" ? "category" : "tag", id: items[cursor]!.id, label: items[cursor]!.name }); ui.setStatus(`Press del again to delete ${items[cursor]!.name}`); return true }
    return true
  }

  if (scope === "settings.rules") {
    const rules = data?.state.rules ?? []; const cursor = ui.state.ruleCursor; const rule = rules[cursor]
    if (name === "escape") { ui.leaveSettings(); return true }
    if (((seq === "J") || (name === "j" && key.shift)) && rule) { data?.reorderSettingsRule(rule.id, cursor + 1); ui.setState({ ruleCursor: Math.min(rules.length - 1, cursor + 1) }); return true }
    if (((seq === "K") || (name === "k" && key.shift)) && rule) { data?.reorderSettingsRule(rule.id, cursor - 1); ui.setState({ ruleCursor: Math.max(0, cursor - 1) }); return true }
    if ((seq === "A" || (name === "a" && key.shift))) { const r = data?.applyRules(); ui.setStatus(r ? `Rules applied · ${r.updatedTransactions} transactions` : "No database"); return true }
    if ((seq === "D" || (name === "d" && key.shift))) { const r = data?.applyRules(undefined, true); ui.setStatus(r ? `Dry run · ${r.updatedTransactions} transactions` : "No database"); return true }
    if (name === "j" || name === "down") { ui.setState({ ruleCursor: Math.min(rules.length - 1, cursor + 1) }); return true }
    if (name === "k" || name === "up") { ui.setState({ ruleCursor: Math.max(0, cursor - 1) }); return true }
    if (name === "a") { ui.openSettingsEditor("rule", null, { ...ui.state.settingsDraft, name: "", savedFilterId: data?.state.savedFilters[0]?.id ?? "", setCategoryId: null, addTagIds: [] }); return true }
    if ((name === "return" || name === "enter") && rule) { ui.openSettingsEditor("rule", rule.id, { ...ui.state.settingsDraft, name: rule.name, savedFilterId: rule.savedFilterId, setCategoryId: rule.setCategoryId, addTagIds: rule.addTagIds }); return true }
    if (name === "space" && rule) { data?.toggleSettingsRule(rule.id, !rule.enabled); return true }
    if (name === "delete" && rule) { ui.armSettingsConfirm({ kind: "rule", id: rule.id, label: rule.name }); ui.setStatus(`Press del again to delete ${rule.name}`); return true }
    return true
  }

  if (scope === "settings.filters") {
    const filters = data?.state.savedFilters ?? []; const cursor = ui.state.filterCursor; const filter = filters[cursor]
    if (name === "escape") { ui.leaveSettings(); return true }
    if (name === "j" || name === "down") { ui.setState({ filterCursor: Math.min(filters.length - 1, cursor + 1) }); return true }
    if (name === "k" || name === "up") { ui.setState({ filterCursor: Math.max(0, cursor - 1) }); return true }
    if (name === "a") { const id = `filter-${filters.length + 1}`; ui.openSettingsEditor("filter", null, { ...ui.state.settingsDraft, id, name: "", expr: "" }); return true }
    if ((name === "return" || name === "enter") && filter) { ui.openSettingsEditor("filter", filter.id, { ...ui.state.settingsDraft, id: filter.id, name: filter.name, expr: filter.expr }); return true }
    if (name === "delete" && filter) { ui.armSettingsConfirm({ kind: "filter", id: filter.id, label: filter.name }); ui.setStatus(`Press del again to delete ${filter.name}`); return true }
    return true
  }

  if (scope === "settings.budgets" && data) {
    const budgets = data.state.budgets
    const budget = budgets[ui.state.budgetCursor]
    if (name === "escape") { ui.leaveSettings(); return true }
    if (name === "j" || name === "down") { ui.setState({ budgetCursor: Math.min(Math.max(0, budgets.length - 1), ui.state.budgetCursor + 1) }); return true }
    if (name === "k" || name === "up") { ui.setState({ budgetCursor: Math.max(0, ui.state.budgetCursor - 1) }); return true }
    if (name === "a") {
      const taken = new Set(budgets.map((b) => scopeKey(b.scope)))
      const free = budgetScopeOptions(data.state.accounts, data.state.categories).find((o) => !taken.has(o.key))
      ui.openSettingsEditor("budget", null, { ...ui.state.settingsDraft, ...cycleDraft(data.state.budgetCycle), scopeKey: free?.key ?? "overall", amount: "" })
      return true
    }
    if ((name === "return" || name === "enter") && budget) {
      ui.openSettingsEditor("budget", budget.id, { ...ui.state.settingsDraft, ...cycleDraft(data.state.budgetCycle), scopeKey: scopeKey(budget.scope), amount: String(budget.amount) })
      return true
    }
    if ((name === "delete" || name === "backspace") && budget) {
      ui.armSettingsConfirm({ kind: "budget", id: budget.id, label: `the ${budgetLabel(budget, data.state.accounts, data.state.categories)} budget` })
      ui.setStatus("Press del to delete the budget")
      return true
    }
    if (name === "c") {
      ui.openSettingsEditor("cycle", null, { ...ui.state.settingsDraft, ...cycleDraft(data.state.budgetCycle) })
      return true
    }
    return true
  }

  if (scope === "settings.up") {
    const accounts = data?.state.syncAccounts ?? []
    const account = accounts[ui.state.upCursor]
    if (name === "escape") { ui.leaveSettings(); return true }
    if (name === "j" || name === "down") { ui.setState({ upCursor: Math.min(Math.max(0, accounts.length - 1), ui.state.upCursor + 1) }); return true }
    if (name === "k" || name === "up") { ui.setState({ upCursor: Math.max(0, ui.state.upCursor - 1) }); return true }
    if (name === "space" && account && data) {
      // Switching off deletes the account's transactions, so it is confirmed.
      if (account.syncEnabled) { ui.armSettingsConfirm({ kind: "desyncAccount", id: account.id, label: account.name }); ui.setStatus(`Press del to stop syncing ${account.name}`); return true }
      try { data.setAccountSync(account.id, true); ui.setStatus(`Sync on for ${account.name} · s to sync now`) } catch (e) { ui.setStatus(e instanceof Error ? e.message : String(e), true) }
      return true
    }
    if (name === "s" && data) {
      if (data.state.upSyncing) { ui.setStatus("Up sync already running"); return true }
      ui.setStatus("Syncing Up…")
      data.syncUp().then(
        (summary) => ui.setStatus(summary),
        (e) => ui.setStatus(e instanceof Error ? e.message : String(e), true),
      )
      return true
    }
    return true
  }

  if (scope === "settings.database") {
    if (name === "escape") { ui.leaveSettings(); return true }
    if (name === "i") {
      try { const directory = data?.importDirectory() ?? process.cwd(); ui.beginImport(directory, data?.csvFiles(directory) ?? []) } catch (e) { ui.setStatus(e instanceof Error ? e.message : String(e), true) }
      return true
    }
    if (name === "p") { ui.setState({ importStage: "profile", importPath: "", importProfileCursor: 0, importProfileManaging: true }); return true }
    if (name === "n" && data) {
      data.setIcons(!data.state.icons)
      ui.setStatus(data.state.icons ? "Category icons on (needs a Nerd Font)" : "Category icons off")
      return true
    }
    if (name === "c") { ui.armSettingsConfirm({ kind: "clearData", id: 0, label: "all transaction and import data" }); ui.setStatus("Press del to clear all transaction and import data"); return true }
    if (name === "x") { ui.setState({ factoryResetOpen: true, factoryResetDraft: "" }); ui.setStatus("Type RESET then enter to remove this SQLite database"); return true }
    return true
  }

  // ── Manager txns ────────────────────────────────────────────────────
  // ── Transactions: grouped by merchant ───────────────────────────────
  if (scope === "manager.merchants" && data) {
    // The same filtered, scoped rows as the table, summarised per merchant.
    const groups = sortMerchantGroups(groupByMerchant(data.scopedTransactions()), ui.state.merchantSort, ui.state.merchantReverse)
    const group = groups[ui.state.merchantCursor]
    const moveTo = (i: number) => ui.setState({ merchantCursor: Math.max(0, Math.min(groups.length - 1, i)) })
    if (name === "a" && !key.shift) { stepAccount(ui, data); ui.setState({ merchantCursor: 0 }); return true }
    if (name === "m") { ui.setState({ txnView: "rows" }); ui.setStatus("Transactions"); return true }
    if (name === "j" || name === "down") { moveTo(ui.state.merchantCursor + 1); return true }
    if (name === "k" || name === "up") { moveTo(ui.state.merchantCursor - 1); return true }
    if (name === "g" && !key.shift) { moveTo(0); return true }
    if ((name === "g" && key.shift) || name === "G") { moveTo(groups.length - 1); return true }
    if (name === "pagedown") { moveTo(ui.state.merchantCursor + ui.state.managerVisible); return true }
    if (name === "pageup") { moveTo(ui.state.merchantCursor - ui.state.managerVisible); return true }
    if (name === "s" && !key.shift) {
      const next = MERCHANT_SORTS[(MERCHANT_SORTS.indexOf(ui.state.merchantSort) + 1) % MERCHANT_SORTS.length]!
      ui.setState({ merchantSort: next, merchantReverse: false, merchantCursor: 0 })
      ui.setStatus(`Merchants by ${next}`)
      return true
    }
    if ((name === "s" && key.shift) || name === "S") { ui.setState({ merchantReverse: !ui.state.merchantReverse, merchantCursor: 0 }); return true }
    if (name === "/" || seq === "/") { ui.openFilter(data.state.filterQuery); return true }
    if ((name === "return" || name === "enter") && group) {
      // Drill in: narrow the filter to this merchant and show its rows.
      const result = data.commitFilter(merchantFilter(data.state.filterQuery, group.merchant))
      if (!result.ok) { ui.setStatus(result.err, true); return true }
      ui.setState({ txnView: "rows" })
      ui.jumpManagerCursor(0, data.scopedTransactions().length)
      ui.setStatus(`${group.merchant} · ${group.count} transaction${group.count === 1 ? "" : "s"} · u to widen`)
      return true
    }
    if (name === "c" && group) { ui.openCatPicker(group.ids); return true }
    if (name === "t" && group) { ui.openTagPicker(group.ids); return true }
    if (name === "u" || name === "escape") {
      if (data.state.filterQuery) { data.clearFilter(); ui.setState({ merchantCursor: 0 }); ui.setStatus("Filter cleared") }
      else { ui.setState({ txnView: "rows" }); ui.setStatus("Transactions") }
      return true
    }
  }

  if (scope === "manager.txns") {
    // Step through the account sidebar's entries (the narrow layout hides it).
    if (name === "a" && !key.shift && data) { stepAccount(ui, data); return true }
    if (name === "m") { ui.setState({ txnView: "merchants", merchantCursor: 0, merchantTop: 0 }); ui.setStatus("Grouped by merchant · m for rows"); return true }
    if (name === "return" || name === "enter") {
      const row = (data?.scopedTransactions() ?? [])[ui.state.managerCursor]
      if (row) ui.setState({ detailId: row.id, detailNotesEditing: false })
      return true
    }
    if (name === "/" || seq === "/") {
      ui.openFilter(data?.state.filterQuery ?? "")
      return true
    }
    if (name === "u" || name === "escape") {
      // Approved OpenTUI deviation from legacy: Esc mirrors u, clearing the
      // current selection/range before an applied filter.
      const nSel = Object.keys(ui.state.selectedIds).length
      if (nSel > 0 || ui.state.rangeSelecting) {
        ui.clearSelection()
        ui.setStatus("Selection cleared")
      } else if (data?.state.filterQuery) {
        data.clearFilter()
        ui.jumpManagerCursor(0, data.scopedTransactions().length)
        ui.setStatus("Filter cleared")
      }
      return true
    }
    if (name === "s" && !key.shift) {
      const col = data?.cycleSortColumn() ?? "date"
      ui.jumpManagerCursor(0, rows.length)
      ui.setStatus(`Sort: ${col} ${data?.state.sortAscending ? "↑" : "↓"}`)
      return true
    }
    if ((name === "s" && key.shift) || name === "S") {
      const asc = data?.toggleSortDirection() ?? false
      ui.setStatus(`Sort: ${data?.state.sortColumn ?? "date"} ${asc ? "↑" : "↓"}`)
      return true
    }
    if (name === "c") {
      if (rows.length === 0) {
        ui.setStatus("No row to categorize", true)
        return true
      }
      ui.openCatPicker(ui.targetIds(rows))
      return true
    }
    if (name === "t") {
      if (rows.length === 0) {
        ui.setStatus("No row to tag", true)
        return true
      }
      ui.openTagPicker(ui.targetIds(rows))
      return true
    }
    if (name === "space" || seq === " ") {
      const hl = ui.highlightedIds(rows)
      const hlIds = Object.keys(hl).map(Number)
      if (ui.state.rangeSelecting && hlIds.length > 0) {
        const allOn = hlIds.every((id) => ui.state.selectedIds[id])
        const next = { ...ui.state.selectedIds }
        for (const id of hlIds) {
          if (allOn) delete next[id]
          else next[id] = true
        }
        ui.setState({ selectedIds: next, rangeSelecting: false })
        ui.setStatus(allOn ? `Deselected ${hlIds.length}` : `Selected ${hlIds.length}`)
      } else {
        const row = rows[ui.state.managerCursor]
        if (row) {
          ui.toggleSelectedId(row.id)
        }
      }
      return true
    }
    if (name === "j" || name === "down") {
      moveTxnCursor(ui, data, 1, key.shift)
      return true
    }
    if (name === "k" || name === "up") {
      moveTxnCursor(ui, data, -1, key.shift)
      return true
    }
    if (name === "g" && !key.shift) {
      ui.jumpManagerCursor(0, rows.length)
      ui.setRangeFromMove(0, 0, false)
      ui.setStatus("Top")
      return true
    }
    if ((name === "g" && key.shift) || name === "G") {
      ui.jumpManagerCursor(rows.length - 1, rows.length)
      ui.setRangeFromMove(0, 0, false)
      ui.setStatus("Bottom")
      return true
    }
    if (name === "pageup") {
      moveTxnCursor(ui, data, -ui.state.managerVisible, key.shift)
      return true
    }
    if (name === "pagedown") {
      moveTxnCursor(ui, data, ui.state.managerVisible, key.shift)
      return true
    }
  }

  // ── Manager accounts ────────────────────────────────────────────────
  // The sidebar selection drives the table directly (no separate apply).
  if (scope === "manager.accounts") {
    const entries = selectableEntries(accounts)
    const select = (index: number) => {
      const entry = entries[index]
      if (!entry || !data) return
      ui.setState({ accountCursor: index, managerCursor: 0, managerTop: 0, selectedIds: {}, rangeSelecting: false })
      data.setAccountSelection(entry.selection)
    }
    if (name === "j" || name === "down") { select(Math.min(entries.length - 1, ui.state.accountCursor + 1)); return true }
    if (name === "k" || name === "up") { select(Math.max(0, ui.state.accountCursor - 1)); return true }
    if (name === "return" || name === "enter" || name === "l" || name === "right") { ui.setState({ focusedSection: "mgr.transactions" }); return true }
    const selection = data?.state.accountSelection
    if ((name === "d" || name === "delete") && typeof selection === "number") { ui.setState({ accountActionId: selection }); ui.setStatus("Account data · c clear transactions · x remove account · esc cancel"); return true }
    return true
  }

  // ── Overview: date range chips ──────────────────────────────────────
  const cycle = data?.state.budgetCycle
  if (scope === "overview.range") {
    if (name === "h" || name === "left") {
      const n = chipCount()
      ui.setDashChipCursor((ui.state.dashChipCursor - 1 + n) % n)
      return true
    }
    if (name === "l" || name === "right") {
      const n = chipCount()
      ui.setDashChipCursor((ui.state.dashChipCursor + 1) % n)
      return true
    }
    if (name === "return" || name === "enter") {
      const tf = applyChip(ui.state.timeframe, ui.state.dashChipCursor, clock, cycle)
      ui.setTimeframe(tf)
      const label = tf.family === "lookback" ? tf.lookback : PERIOD_LABEL[tf.period]
      ui.setStatus(`${tf.family === "lookback" ? "Timeframe" : "Period"}: ${label} · ${timeframeBounds(tf, clock, cycle).label}`)
      return true
    }
  }

  // ── Overview ────────────────────────────────────────────────────────
  if (scope === "overview" || scope === "overview.range") {
    // h/l (or ,/.) step the focused chart pane's views, the top pane when
    // neither is focused; H/L always step the bottom pane.
    const back = seq === "H" || ((name === "h" || name === "left" || seq === ",") && scope === "overview")
    const forward = seq === "L" || ((name === "l" || name === "right" || seq === ".") && scope === "overview")
    if (back || forward) {
      const pane = seq === "H" || seq === "L" || key.shift || ui.state.focusedSection === "ov.chart2" ? 1 : 0
      const n = CHART_VIEWS.length
      const views: [number, number] = [...ui.state.chartViews]
      views[pane] = (views[pane] + (back ? -1 : 1) + n) % n
      ui.setState({ chartViews: views })
      return true
    }
    // Which spending account the period covers: all, or one of them.
    if (name === "a" && data) {
      const choices: AccountSelection[] = ["all", ...data.state.accounts.filter((a) => accountRole(a) === "spending").map((a) => a.id)]
      const at = choices.indexOf(data.state.accountSelection)
      const next = choices[(at + 1) % choices.length]!
      data.setAccountSelection(next)
      ui.setStatus(`Overview · ${spendingScope(data.state.accounts, next).label}`)
      return true
    }
    if (name === "[" || seq === "[" || name === "]" || seq === "]") {
      if (ui.state.timeframe.family === "period") {
        const tf = stepPeriod(ui.state.timeframe, name === "[" || seq === "[" ? -1 : 1, cycle)
        ui.setTimeframe(tf)
        ui.setStatus(`${PERIOD_LABEL[tf.period]} · ${timeframeBounds(tf, clock, cycle).label}`)
      }
      return true
    }
    if (name === "0") {
      // Back to the default view: the current budget cycle.
      const tf = applyChip({ ...ui.state.timeframe, family: "period", period: "cycle" }, LOOKBACKS.length, clock, cycle)
      ui.setTimeframe(tf)
      ui.setDashChipCursor(activeChipIndex(tf))
      ui.setStatus(`This cycle · ${timeframeBounds(tf, clock, cycle).label}`)
      return true
    }
  }

  if (name === "escape" && ui.state.focusedSection !== "none") {
    ui.clearFocus()
    return true
  }

  return false
}


export function footerHints(scope: ScopeId): { key: string; desc: string }[] {
  switch (scope) {
    case "jump":
      return [
        { key: "letter", desc: "jump" },
        { key: "esc", desc: "cancel" },
      ]
    case "filter":
      return [
        { key: "enter", desc: "apply" },
        { key: "esc", desc: "clear" },
        { key: "type", desc: "expr" },
      ]
    case "catPicker":
      return [
        { key: "j/k", desc: "move" },
        { key: "enter", desc: "apply" },
        { key: "esc", desc: "cancel" },
        { key: "type", desc: "filter" },
      ]
    case "tagPicker":
      return [
        { key: "j/k", desc: "move" },
        { key: "space", desc: "toggle" },
        { key: "enter", desc: "done" },
        { key: "esc", desc: "cancel" },
      ]
    case "overview":
      return [
        { key: "h/l", desc: "chart" },
        { key: "H/L", desc: "bottom chart" },
        { key: "a", desc: "account" },
        { key: "[/]", desc: "period" },
        { key: "0", desc: "this cycle" },
        { key: "v", desc: "jump" },
        { key: "1-3", desc: "tab" },
      ]
    case "overview.range":
      return [
        { key: "h/l", desc: "chip" },
        { key: "enter", desc: "apply" },
        { key: "[/]", desc: "shift period" },
        { key: "esc", desc: "done" },
      ]
    case "manager.detail":
      return [{ key: "j/k", desc: "prev/next" }, { key: "c", desc: "category" }, { key: "t", desc: "tags" }, { key: "n", desc: "notes" }, { key: "esc", desc: "close" }]
    case "manager.detail.notes":
      return [{ key: "type", desc: "notes" }, { key: "enter", desc: "save" }, { key: "esc", desc: "cancel" }]
    case "manager.merchants":
      return [
        { key: "enter", desc: "its transactions" },
        { key: "j/k", desc: "move" },
        { key: "c", desc: "category" },
        { key: "t", desc: "tags" },
        { key: "s", desc: "sort" },
        { key: "/", desc: "filter" },
        { key: "m", desc: "rows" },
        { key: "a", desc: "account" },
      ]
    case "manager.txns":
      return [
        { key: "enter", desc: "detail" },
        { key: "j/k", desc: "move" },
        { key: "m", desc: "merchants" },
        { key: "a", desc: "account" },
        { key: "S-j/k", desc: "range" },
        { key: "space", desc: "select" },
        { key: "c", desc: "cat" },
        { key: "t", desc: "tag" },
        { key: "s", desc: "sort" },
        { key: "S-s", desc: "reverse" },
        { key: "esc/u", desc: "clear" },
        { key: "/", desc: "filter" },
        { key: "v", desc: "jump" },
      ]
    case "manager.accounts":
      return [
        { key: "j/k", desc: "account" },
        { key: "enter", desc: "transactions" },
        { key: "d", desc: "data actions" },
        { key: "v", desc: "jump" },
      ]
    case "settings":
      return [
        { key: "j/k", desc: "section" },
        { key: "h/l", desc: "column" },
        { key: "enter", desc: "activate" },
        { key: "v", desc: "jump" },
        { key: "1-3", desc: "tab" },
      ]
    case "settings.taxonomy":
      return [
        { key: "h/l", desc: "list" }, { key: "j/k", desc: "move" },
        { key: "a", desc: "add" }, { key: "enter", desc: "edit" },
        { key: "del", desc: "delete" }, { key: "esc", desc: "done" },
      ]
    case "settings.rules":
      return [
        { key: "j/k", desc: "move" }, { key: "space", desc: "toggle" },
        { key: "a", desc: "add" }, { key: "S-j/k", desc: "reorder" },
        { key: "S-a", desc: "apply" }, { key: "S-d", desc: "dry run" }, { key: "esc", desc: "done" },
      ]
    case "settings.filters":
      return [{ key: "j/k", desc: "move" }, { key: "a", desc: "add" }, { key: "enter", desc: "edit" }, { key: "del", desc: "delete" }, { key: "esc", desc: "done" }]
    case "settings.budgets":
      return [{ key: "j/k", desc: "move" }, { key: "a", desc: "add" }, { key: "enter", desc: "edit" }, { key: "del", desc: "delete" }, { key: "c", desc: "cycle" }, { key: "esc", desc: "done" }]
    case "settings.up":
      return [{ key: "j/k", desc: "move" }, { key: "space", desc: "sync on/off" }, { key: "s", desc: "sync now" }, { key: "esc", desc: "done" }]
    case "settings.database":
      return [{ key: "i", desc: "import" }, { key: "p", desc: "profiles" }, { key: "n", desc: "icons" }, { key: "c", desc: "clear data" }, { key: "x", desc: "reset DB" }, { key: "esc", desc: "done" }]
    case "settings.import.files":
      return [{ key: "j/k", desc: "file" }, { key: "enter", desc: "select" }, { key: "p", desc: "path" }, { key: "esc", desc: "cancel" }]
    case "settings.import.path":
      return [{ key: "enter", desc: "open" }, { key: "esc", desc: "back" }, { key: "type", desc: "path" }]
    case "settings.import.profile":
      return [{ key: "j/k", desc: "profile" }, { key: "enter", desc: "select" }, { key: "a/e", desc: "new/edit" }, { key: "del", desc: "delete" }, { key: "esc", desc: "back" }]
    case "settings.import.profileEditor":
      return [{ key: "tab", desc: "field" }, { key: "h/l", desc: "choice" }, { key: "enter", desc: "save" }, { key: "esc", desc: "back" }]
    case "settings.import.preview":
      return [{ key: "s", desc: "skip dupes" }, { key: "a", desc: "force import" }, { key: "p", desc: "all/dupes" }, { key: "r", desc: "rules" }, { key: "esc", desc: "cancel" }]
    case "manager.accountAction":
      return [{ key: "c", desc: "clear txns" }, { key: "x", desc: "remove account" }, { key: "esc", desc: "cancel" }]
    case "settings.factoryReset":
      return [{ key: "type RESET", desc: "confirm" }, { key: "enter", desc: "erase DB" }, { key: "esc", desc: "cancel" }]
    case "settings.editor":
      return [{ key: "↑/↓", desc: "field" }, { key: "←/→", desc: "change" }, { key: "enter", desc: "save / choose" }, { key: "esc", desc: "cancel" }]
    case "settings.confirm":
      return [{ key: "del", desc: "confirm" }, { key: "esc", desc: "cancel" }]
    default:
      return [{ key: "v", desc: "jump" }]
  }
}

/** The Date Range period as [start, end] ISO dates. */
/** The budget cycle as editor draft fields. */
function cycleDraft(cycle: CycleConfig): { unit: CycleConfig["unit"]; anchor: CycleConfig["anchor"]; anchorDate: string } {
  return { unit: cycle.unit, anchor: cycle.anchor, anchorDate: cycle.anchorDate ?? "" }
}

/** Show the next account sidebar entry (the Transactions tab's `a`). */
function stepAccount(ui: UiStore, data: DataStore): void {
  const entries = selectableEntries(data.state.accounts)
  if (!entries.length) return
  const at = entries.findIndex((e) => e.selection === data.state.accountSelection)
  const next = (at + 1) % entries.length
  ui.setState({ accountCursor: next })
  data.setAccountSelection(entries[next]!.selection)
  ui.jumpManagerCursor(0, data.scopedTransactions().length)
  ui.setStatus(`Showing ${entries[next]!.label}`)
}
