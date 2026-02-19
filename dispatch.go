package main

// ---------------------------------------------------------------------------
// Shared dispatch table: single source of truth for overlay/modal priority
// ---------------------------------------------------------------------------
//
// Three consumers read this table:
//   - Update (update.go)    — finds the active handler for a tea.KeyMsg
//   - footerBindings (app.go)  — finds the active scope for footer hints
//   - commandContextScope (commands.go) — finds the active scope for command availability
//
// Adding a new overlay/modal: add one entry in the correct priority position.
// All three consumers automatically stay in sync.

import (
	"strings"

	"github.com/charmbracelet/bubbles/key"
	tea "github.com/charmbracelet/bubbletea"
)

// overlayEntry defines one level in the overlay precedence chain.
// Guard returns true when this overlay is active.
// Scope is the keybinding scope for this overlay.
// Handler dispatches tea.KeyMsg to the overlay's update function.
// ForFooter indicates whether footerBindings should use this entry.
// ForCommandScope indicates whether commandContextScope should use this entry.
// (commandOpen is checked by Update and footerBindings but NOT by commandContextScope,
// because commandContextScope is only called after the commandOpen check has failed.)
type overlayEntry struct {
	name            string
	guard           func(m model) bool
	scope           func(m model) string // returns scope; most entries return a constant
	handler         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd)
	forFooter       bool
	forCommandScope bool
}

// overlayPrecedence returns the authoritative overlay priority table, ordered
// highest to lowest. The first matching guard wins. This is a function (not a
// package var) to avoid Go initialization cycles, since some handler closures
// transitively reference functions that call back into this table.
func overlayPrecedence() []overlayEntry {
	return []overlayEntry{
		{
			name:            "jump",
			guard:           func(m model) bool { return m.jumpModeActive },
			scope:           func(m model) string { return scopeJumpOverlay },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateJumpOverlay(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:  "command",
			guard: func(m model) bool { return m.commandOpen },
			scope: func(m model) string {
				if m.commandUIKind == commandUIKindPalette {
					return scopeCommandPalette
				}
				return scopeCommandMode
			},
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateCommandUI(msg) },
			forFooter:       true,
			forCommandScope: false, // unreachable from executeBoundCommand
		},
		{
			name:            "detail",
			guard:           func(m model) bool { return m.showDetail },
			scope:           func(m model) string { return scopeDetailModal },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateDetail(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "importPreview",
			guard:           func(m model) bool { return m.importPreviewOpen },
			scope:           func(m model) string { return scopeImportPreview },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateImportPreview(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "filePicker",
			guard:           func(m model) bool { return m.importPicking },
			scope:           func(m model) string { return scopeFilePicker },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateFilePicker(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "catPicker",
			guard:           func(m model) bool { return m.catPicker != nil },
			scope:           func(m model) string { return scopeCategoryPicker },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateCatPicker(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "tagPicker",
			guard:           func(m model) bool { return m.tagPicker != nil },
			scope:           func(m model) string { return scopeTagPicker },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateTagPicker(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "quickOffset",
			guard:           func(m model) bool { return m.allocationModalOpen },
			scope:           func(m model) string { return scopeQuickOffset },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateAllocationAmountModal(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "filterApplyPicker",
			guard:           func(m model) bool { return m.filterApplyPicker != nil },
			scope:           func(m model) string { return scopeFilterApplyPicker },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateFilterApplyPicker(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "managerActionPicker",
			guard:           func(m model) bool { return m.managerActionPicker != nil },
			scope:           func(m model) string { return scopeManagerAccountAction },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateManagerActionPicker(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "filterEdit",
			guard:           func(m model) bool { return m.filterEditOpen },
			scope:           func(m model) string { return scopeFilterEdit },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateFilterEdit(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "managerModal",
			guard:           func(m model) bool { return m.managerModalOpen },
			scope:           func(m model) string { return scopeManagerModal },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateManagerModal(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "dryRun",
			guard:           func(m model) bool { return m.dryRunOpen },
			scope:           func(m model) string { return scopeDryRunModal },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateDryRunModal(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "ruleEditor",
			guard:           func(m model) bool { return m.ruleEditorOpen },
			scope:           func(m model) string { return scopeRuleEditor },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateRuleEditor(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "filterInput",
			guard:           func(m model) bool { return m.filterInputMode },
			scope:           func(m model) string { return scopeFilterInput },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateFilterInput(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
	}
}

// dispatchOverlayKey finds the first matching overlay and dispatches the key.
// Returns (model, cmd, true) if an overlay handled it, or (model, nil, false)
// if no overlay matched and the caller should continue with tab-level dispatch.
func (m model) dispatchOverlayKey(msg tea.KeyMsg) (tea.Model, tea.Cmd, bool) {
	for _, entry := range overlayPrecedence() {
		if entry.guard(m) {
			result, cmd := entry.handler(m, msg)
			return result, cmd, true
		}
	}
	return m, nil, false
}

// activeOverlayScope returns the scope of the highest-priority active overlay,
// or "" if no overlay is active.
// Pass forFooter=true from footerBindings, forFooter=false from commandContextScope.
func (m model) activeOverlayScope(forFooter bool) string {
	for _, entry := range overlayPrecedence() {
		if forFooter && !entry.forFooter {
			continue
		}
		if !forFooter && !entry.forCommandScope {
			continue
		}
		if entry.guard(m) {
			return entry.scope(m)
		}
	}
	return ""
}

// ---------------------------------------------------------------------------
// Interaction contracts (Phase 7 hardening)
// ---------------------------------------------------------------------------
// Contracts declare semantic intent per scope so footer hints, key lookup,
// and handler-behavior tests can all derive from shared data.

type InteractionIntent string

const (
	IntentMovePrev InteractionIntent = "move_prev"
	IntentMoveNext InteractionIntent = "move_next"
	IntentSelect   InteractionIntent = "select"
	IntentToggle   InteractionIntent = "toggle"
	IntentEdit     InteractionIntent = "edit"
	IntentConfirm  InteractionIntent = "confirm"
	IntentSave     InteractionIntent = "save"
	IntentCancel   InteractionIntent = "cancel"
	IntentDelete   InteractionIntent = "delete"
	IntentApply    InteractionIntent = "apply"
)

type ContextKind string

const (
	ContextList       ContextKind = "list"
	ContextForm       ContextKind = "form"
	ContextViewer     ContextKind = "viewer"
	ContextWorkflow   ContextKind = "workflow"
	ContextInlineEdit ContextKind = "inline_edit"
)

type InteractionHint struct {
	Intent InteractionIntent
	Label  string
	Omit   bool
	Action Action
}

type InteractionContract struct {
	Scope string
	Kind  ContextKind
	Hints []InteractionHint
}

func showHint(intent InteractionIntent, action Action, label string) InteractionHint {
	return InteractionHint{Intent: intent, Action: action, Label: label}
}

func hideHint(intent InteractionIntent, action Action) InteractionHint {
	return InteractionHint{Intent: intent, Action: action, Omit: true}
}

// interactionContracts is the contract registry for all reachable overlay/tab
// scopes used by footer rendering.
var interactionContracts = map[string]InteractionContract{
	scopeJumpOverlay: {
		Scope: scopeJumpOverlay,
		Kind:  ContextWorkflow,
		Hints: []InteractionHint{
			showHint(IntentCancel, actionJumpCancel, "cancel"),
		},
	},
	scopeCommandPalette: {
		Scope: scopeCommandPalette,
		Kind:  ContextList,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			showHint(IntentSelect, actionSelect, "run"),
			showHint(IntentCancel, actionClose, "close"),
		},
	},
	scopeCommandMode: {
		Scope: scopeCommandMode,
		Kind:  ContextList,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			showHint(IntentSelect, actionSelect, "run"),
			showHint(IntentCancel, actionClose, "close"),
		},
	},
	scopeDetailModal: {
		Scope: scopeDetailModal,
		Kind:  ContextViewer,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentSelect, actionSelect),
			showHint(IntentEdit, actionEdit, "notes"),
			showHint(IntentCancel, actionQuit, "quit"),
		},
	},
	scopeImportPreview: {
		Scope: scopeImportPreview,
		Kind:  ContextWorkflow,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentCancel, actionClose),
			showHint(IntentApply, actionImportAll, "all"),
			showHint(IntentApply, actionSkipDupes, "skip"),
			showHint(IntentToggle, actionImportPreviewToggle, "preview"),
			showHint(IntentApply, actionImportRawView, "rules"),
		},
	},
	scopeFilePicker: {
		Scope: scopeFilePicker,
		Kind:  ContextList,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentSelect, actionSelect),
			hideHint(IntentCancel, actionClose),
			showHint(IntentCancel, actionQuit, "quit"),
		},
	},
	scopeCategoryPicker: {
		Scope: scopeCategoryPicker,
		Kind:  ContextList,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentSelect, actionSelect),
			hideHint(IntentCancel, actionClose),
			hideHint(IntentApply, actionSelect),
		},
	},
	scopeTagPicker: {
		Scope: scopeTagPicker,
		Kind:  ContextList,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentToggle, actionToggleSelect),
			hideHint(IntentSelect, actionSelect),
			hideHint(IntentCancel, actionClose),
			hideHint(IntentApply, actionSelect),
		},
	},
	scopeQuickOffset: {
		Scope: scopeQuickOffset,
		Kind:  ContextInlineEdit,
		Hints: []InteractionHint{
			hideHint(IntentEdit, actionLeft),
			hideHint(IntentEdit, actionRight),
			showHint(IntentApply, actionConfirm, "apply"),
			showHint(IntentCancel, actionClose, "cancel"),
		},
	},
	scopeFilterApplyPicker: {
		Scope: scopeFilterApplyPicker,
		Kind:  ContextList,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentSelect, actionSelect),
			hideHint(IntentCancel, actionClose),
			hideHint(IntentApply, actionSelect),
		},
	},
	scopeManagerAccountAction: {
		Scope: scopeManagerAccountAction,
		Kind:  ContextList,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentSelect, actionSelect),
			hideHint(IntentCancel, actionClose),
		},
	},
	scopeFilterEdit: {
		Scope: scopeFilterEdit,
		Kind:  ContextForm,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentEdit, actionLeft),
			hideHint(IntentEdit, actionRight),
			hideHint(IntentSave, actionSave),
			hideHint(IntentCancel, actionClose),
		},
	},
	scopeManagerModal: {
		Scope: scopeManagerModal,
		Kind:  ContextForm,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentToggle, actionToggleSelect),
			hideHint(IntentSave, actionConfirm),
			hideHint(IntentCancel, actionClose),
		},
	},
	scopeDryRunModal: {
		Scope: scopeDryRunModal,
		Kind:  ContextViewer,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentCancel, actionClose),
		},
	},
	scopeRuleEditor: {
		Scope: scopeRuleEditor,
		Kind:  ContextForm,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentToggle, actionToggleSelect),
			hideHint(IntentConfirm, actionSelect),
			hideHint(IntentSave, actionSelect),
			hideHint(IntentCancel, actionClose),
		},
	},
	scopeFilterInput: {
		Scope: scopeFilterInput,
		Kind:  ContextInlineEdit,
		Hints: []InteractionHint{
			hideHint(IntentEdit, actionLeft),
			hideHint(IntentEdit, actionRight),
			hideHint(IntentCancel, actionClearSearch),
			showHint(IntentSave, actionFilterSave, "save"),
			showHint(IntentApply, actionFilterLoad, "load"),
		},
	},
	scopeDashboard: {
		Scope: scopeDashboard,
		Kind:  ContextWorkflow,
		Hints: []InteractionHint{
			showHint(IntentMovePrev, actionBudgetPrevMonth, "prev month"),
			showHint(IntentMoveNext, actionBudgetNextMonth, "next month"),
			showHint(IntentApply, actionTimeframeThisMonth, "this month"),
		},
	},
	scopeDashboardTimeframe: {
		Scope: scopeDashboardTimeframe,
		Kind:  ContextForm,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionLeft),
			hideHint(IntentMoveNext, actionRight),
			showHint(IntentMovePrev, actionBudgetPrevMonth, "prev month"),
			showHint(IntentMoveNext, actionBudgetNextMonth, "next month"),
			showHint(IntentApply, actionTimeframeThisMonth, "this month"),
			showHint(IntentConfirm, actionSelect, "apply"),
			showHint(IntentCancel, actionCancel, "done"),
		},
	},
	scopeDashboardCustomInput: {
		Scope: scopeDashboardCustomInput,
		Kind:  ContextInlineEdit,
		Hints: []InteractionHint{
			hideHint(IntentApply, actionConfirm),
			hideHint(IntentCancel, actionCancel),
		},
	},
	scopeDashboardFocused: {
		Scope: scopeDashboardFocused,
		Kind:  ContextWorkflow,
		Hints: []InteractionHint{
			showHint(IntentMoveNext, actionDashboardModeNext, "next"),
			showHint(IntentMovePrev, actionDashboardModePrev, "prev"),
			showHint(IntentSelect, actionDashboardDrillDown, "drill"),
			showHint(IntentEdit, actionDashboardCustomModeEdit, "custom"),
			hideHint(IntentCancel, actionCancel),
		},
	},
	scopeTransactions: {
		Scope: scopeTransactions,
		Kind:  ContextList,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentSelect, actionSelect),
			hideHint(IntentCancel, actionClearSearch),
			showHint(IntentEdit, actionSearch, "filter"),
			showHint(IntentSave, actionFilterSave, "save"),
			showHint(IntentApply, actionFilterLoad, "load"),
			showHint(IntentEdit, actionSort, "sort"),
			showHint(IntentToggle, actionSortDirection, "reverse"),
			showHint(IntentApply, actionQuickCategory, "cat"),
			showHint(IntentApply, actionQuickTag, "tag"),
			showHint(IntentEdit, actionQuickOffset, "split"),
			showHint(IntentDelete, actionDelete, "delete"),
			showHint(IntentCancel, actionCommandClearSelection, "clear"),
			showHint(IntentMovePrev, actionJumpTop, "top"),
			showHint(IntentMoveNext, actionJumpBottom, "bottom"),
		},
	},
	scopeManager: {
		Scope: scopeManager,
		Kind:  ContextWorkflow,
		Hints: []InteractionHint{
			showHint(IntentEdit, actionSearch, "filter"),
			showHint(IntentApply, actionFilterLoad, "load"),
			showHint(IntentEdit, actionAdd, "add"),
			showHint(IntentDelete, actionDelete, "actions"),
			showHint(IntentCancel, actionQuit, "quit"),
		},
	},
	scopeManagerTransactions: {
		Scope: scopeManagerTransactions,
		Kind:  ContextWorkflow,
		Hints: []InteractionHint{
			showHint(IntentApply, actionFocusAccounts, "accounts"),
		},
	},
	scopeBudget: {
		Scope: scopeBudget,
		Kind:  ContextWorkflow,
		Hints: []InteractionHint{
			showHint(IntentMovePrev, actionBudgetPrevMonth, "prev month"),
			showHint(IntentMoveNext, actionBudgetNextMonth, "next month"),
			showHint(IntentApply, actionTimeframeThisMonth, "this month"),
			showHint(IntentToggle, actionBudgetToggleView, "view"),
			showHint(IntentEdit, actionBudgetEdit, "edit"),
			showHint(IntentEdit, actionBudgetAddTarget, "add"),
			showHint(IntentDelete, actionBudgetDeleteTarget, "delete"),
			showHint(IntentApply, actionBudgetResetOverride, "reset"),
		},
	},
	scopeSettingsNav: {
		Scope: scopeSettingsNav,
		Kind:  ContextList,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentSelect, actionActivate),
			hideHint(IntentCancel, actionQuit),
			showHint(IntentApply, actionImport, "import"),
		},
	},
	scopeSettingsModeCat: {
		Scope: scopeSettingsModeCat,
		Kind:  ContextForm,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentSave, actionSave),
			hideHint(IntentCancel, actionClose),
		},
	},
	scopeSettingsModeTag: {
		Scope: scopeSettingsModeTag,
		Kind:  ContextForm,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentSave, actionSave),
			hideHint(IntentCancel, actionClose),
		},
	},
	scopeSettingsModeRule: {
		Scope: scopeSettingsModeRule,
		Kind:  ContextForm,
		Hints: []InteractionHint{
			hideHint(IntentConfirm, actionSelect),
			hideHint(IntentCancel, actionClose),
		},
	},
	scopeSettingsModeRuleCat: {
		Scope: scopeSettingsModeRuleCat,
		Kind:  ContextForm,
		Hints: []InteractionHint{
			hideHint(IntentConfirm, actionSelect),
			hideHint(IntentCancel, actionClose),
		},
	},
	scopeSettingsActiveCategories: {
		Scope: scopeSettingsActiveCategories,
		Kind:  ContextList,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentSelect, actionSelect),
			hideHint(IntentCancel, actionBack),
			showHint(IntentEdit, actionAdd, "add"),
			showHint(IntentDelete, actionDelete, "delete"),
		},
	},
	scopeSettingsActiveTags: {
		Scope: scopeSettingsActiveTags,
		Kind:  ContextList,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentSelect, actionSelect),
			hideHint(IntentCancel, actionBack),
			showHint(IntentEdit, actionAdd, "add"),
			showHint(IntentDelete, actionDelete, "delete"),
		},
	},
	scopeSettingsActiveRules: {
		Scope: scopeSettingsActiveRules,
		Kind:  ContextList,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentSelect, actionSelect),
			hideHint(IntentCancel, actionBack),
			showHint(IntentEdit, actionAdd, "add"),
			showHint(IntentDelete, actionDelete, "delete"),
			showHint(IntentMovePrev, actionRuleMoveUp, "move up"),
			showHint(IntentMoveNext, actionRuleMoveDown, "move down"),
			showHint(IntentApply, actionApplyAll, "apply all"),
			showHint(IntentApply, actionRuleDryRun, "dry run"),
		},
	},
	scopeSettingsActiveFilters: {
		Scope: scopeSettingsActiveFilters,
		Kind:  ContextList,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentSelect, actionSelect),
			hideHint(IntentCancel, actionBack),
			showHint(IntentEdit, actionAdd, "add"),
			showHint(IntentDelete, actionDelete, "delete"),
		},
	},
	scopeSettingsActiveChart: {
		Scope: scopeSettingsActiveChart,
		Kind:  ContextWorkflow,
		Hints: []InteractionHint{
			showHint(IntentMovePrev, actionLeft, "week"),
			showHint(IntentMoveNext, actionRight, "week"),
			hideHint(IntentConfirm, actionConfirm),
			hideHint(IntentCancel, actionBack),
		},
	},
	scopeSettingsActiveDBImport: {
		Scope: scopeSettingsActiveDBImport,
		Kind:  ContextWorkflow,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentCancel, actionBack),
			showHint(IntentEdit, actionRowsPerPage, "rows"),
			showHint(IntentApply, actionCommandDefault, "default"),
			showHint(IntentDelete, actionClearDB, "clear"),
			showHint(IntentApply, actionImport, "import"),
			showHint(IntentApply, actionResetKeybindings, "reset"),
		},
	},
	scopeSettingsActiveImportHist: {
		Scope: scopeSettingsActiveImportHist,
		Kind:  ContextList,
		Hints: []InteractionHint{
			hideHint(IntentMovePrev, actionUp),
			hideHint(IntentMoveNext, actionDown),
			hideHint(IntentCancel, actionBack),
			hideHint(IntentSelect, actionSelect),
		},
	},
	scopeGlobal: {
		Scope: scopeGlobal,
		Kind:  ContextWorkflow,
		Hints: []InteractionHint{
			showHint(IntentApply, actionCommandGoDashboard, "dashboard"),
			showHint(IntentApply, actionCommandGoBudget, "budget"),
			showHint(IntentApply, actionCommandGoTransactions, "manager"),
			showHint(IntentApply, actionCommandGoSettings, "settings"),
			showHint(IntentApply, actionJumpMode, "jump"),
			showHint(IntentApply, actionCommandPalette, "commands"),
			showHint(IntentApply, actionCommandMode, "command"),
			showHint(IntentCancel, actionQuit, "quit"),
		},
	},
}

func scopeHasInteractionContract(scope string) bool {
	_, ok := interactionContracts[scope]
	return ok
}

func interactionContractForScope(scope string) InteractionContract {
	if c, ok := interactionContracts[scope]; ok {
		return c
	}
	return InteractionContract{Scope: scope, Kind: ContextWorkflow}
}

func settingsConfirmInteractionContract(spec settingsConfirmSpec) InteractionContract {
	return InteractionContract{
		Scope: spec.scope,
		Kind:  ContextWorkflow,
		Hints: []InteractionHint{
			showHint(IntentConfirm, spec.action, "confirm"),
			showHint(IntentCancel, actionBack, "cancel"),
		},
	}
}

// activeInteractionContract resolves the current scope using the existing
// dispatch-table logic, then returns the registered interaction contract.
func (m model) activeInteractionContract() InteractionContract {
	if scope := m.activeOverlayScope(true); scope != "" {
		return interactionContractForScope(scope)
	}
	if m.activeTab == tabSettings && m.confirmAction != confirmActionNone {
		if spec, ok := settingsConfirmSpecFor(m.confirmAction); ok {
			return settingsConfirmInteractionContract(spec)
		}
	}
	scope := m.tabScope()
	if strings.TrimSpace(scope) == "" {
		scope = scopeGlobal
	}
	return interactionContractForScope(scope)
}

func interactionActionForHint(h InteractionHint) (Action, bool) {
	if h.Action != "" {
		return h.Action, true
	}
	switch h.Intent {
	case IntentMovePrev:
		return actionUp, true
	case IntentMoveNext:
		return actionDown, true
	case IntentSelect:
		return actionSelect, true
	case IntentToggle:
		return actionToggleSelect, true
	case IntentEdit:
		return actionEdit, true
	case IntentConfirm:
		return actionConfirm, true
	case IntentSave:
		return actionSave, true
	case IntentCancel:
		return actionCancel, true
	case IntentDelete:
		return actionDelete, true
	case IntentApply:
		return actionApplyAll, true
	default:
		return "", false
	}
}

func primaryKeyForScopeAction(keys *KeyRegistry, scope string, action Action) (string, bool) {
	if keys == nil {
		return "", false
	}
	for _, b := range keys.BindingsForScope(scope) {
		if b.Action == action && len(b.Keys) > 0 {
			return b.Keys[0], true
		}
	}
	return "", false
}

func renderFooterFromContract(contract InteractionContract, keys *KeyRegistry) []key.Binding {
	if strings.TrimSpace(contract.Scope) == "" {
		return nil
	}
	if keys == nil {
		keys = NewKeyRegistry()
	}
	out := make([]key.Binding, 0, len(contract.Hints))
	for _, hint := range contract.Hints {
		if hint.Omit || strings.TrimSpace(hint.Label) == "" {
			continue
		}
		action, ok := interactionActionForHint(hint)
		if !ok {
			continue
		}
		keyName, ok := primaryKeyForScopeAction(keys, contract.Scope, action)
		if !ok || strings.TrimSpace(keyName) == "" {
			continue
		}
		out = append(out, key.NewBinding(
			key.WithKeys(keyName),
			key.WithHelp(keyName, hint.Label),
		))
	}
	return out
}

func contractHasIntent(contract InteractionContract, intent InteractionIntent) bool {
	for _, hint := range contract.Hints {
		if hint.Intent == intent {
			return true
		}
	}
	return false
}

// ---------------------------------------------------------------------------
// Modal text input contract
// ---------------------------------------------------------------------------
// Declares how each modal scope handles text input. This contract is the
// single source of truth for text input behavior, replacing the manual
// isTextInputModalScope() function in update.go with a data-driven approach.
//
// When adding a new modal with text fields, add an entry here. Tests verify
// that every modal scope with cursorAware=true uses the cursor-aware helpers
// and that vimNavSuppressed scopes don't bind h/j/k/l as navigation.

// modalTextBehavior declares how a modal handles text input fields.
type modalTextBehavior struct {
	cursorAware      bool // true = use insertPrintableASCIIAtCursor; false = appendPrintableASCII
	printableFirst   bool // true = printable keys are literal text, not shortcuts
	vimNavSuppressed bool // true = h/j/k/l suppressed as navigation in this scope
}

// modalTextContracts maps modal scopes to their text input behavior.
// Every modal scope that contains text-editable fields must have an entry.
var modalTextContracts = map[string]modalTextBehavior{
	scopeRuleEditor:           {cursorAware: true, printableFirst: true, vimNavSuppressed: true},
	scopeFilterEdit:           {cursorAware: true, printableFirst: true, vimNavSuppressed: true},
	scopeSettingsModeCat:      {cursorAware: true, printableFirst: true, vimNavSuppressed: true},
	scopeSettingsModeTag:      {cursorAware: true, printableFirst: true, vimNavSuppressed: true},
	scopeQuickOffset:          {cursorAware: true, printableFirst: true, vimNavSuppressed: true},
	scopeManagerModal:         {cursorAware: true, printableFirst: true, vimNavSuppressed: true},
	scopeDetailModal:          {cursorAware: true, printableFirst: true, vimNavSuppressed: false}, // detail modal uses dedicated updateDetailNotes handler when editing; j/k needed for non-editing scroll
	scopeFilterInput:          {cursorAware: true, printableFirst: true, vimNavSuppressed: false},
	scopeDashboardCustomInput: {cursorAware: false, printableFirst: true, vimNavSuppressed: false},
}

// isTextInputModalScope returns true if the given scope has text-editable fields
// that require vim-nav suppression (h/j/k/l must not be interpreted as navigation).
// This replaces the manual switch in update.go with a data-driven lookup.
func isTextInputModalScopeFromContract(scope string) bool {
	if b, ok := modalTextContracts[scope]; ok {
		return b.vimNavSuppressed
	}
	return false
}

// scopeHasTextContract returns true if the given scope has a registered
// text input contract. Used by tests to verify completeness.
func scopeHasTextContract(scope string) bool {
	_, ok := modalTextContracts[scope]
	return ok
}

// ---------------------------------------------------------------------------
// Reusable form helpers
// ---------------------------------------------------------------------------
// Lightweight helpers for modal forms and text fields. These don't replace
// context-specific logic but provide consistent building blocks that new
// modals and editors should compose from.

// textField bundles a string value with its cursor position. Use this for
// any text input field that needs cursor-aware editing.
type textField struct {
	Value  string
	Cursor int
}

// handleKey processes a single key event for a text field. Returns true if
// the key was consumed (printable input, backspace, or cursor movement).
func (f *textField) handleKey(keyName string, rawKey string) bool {
	switch keyName {
	case "backspace":
		deleteASCIIByteBeforeCursor(&f.Value, &f.Cursor)
		return true
	case "left":
		moveInputCursorASCII(f.Value, &f.Cursor, -1)
		return true
	case "right":
		moveInputCursorASCII(f.Value, &f.Cursor, 1)
		return true
	default:
		return insertPrintableASCIIAtCursor(&f.Value, &f.Cursor, rawKey)
	}
}

// render returns the text with a cursor marker at the current position.
func (f *textField) render() string {
	return renderASCIIInputCursor(f.Value, f.Cursor)
}

// set replaces the value and places the cursor at the end.
func (f *textField) set(value string) {
	f.Value = value
	f.Cursor = len(value)
}

// modalFormNav provides shared focus-cycling for modal forms with a fixed
// number of fields. It handles up/down/tab/shift-tab navigation.
type modalFormNav struct {
	FieldCount int
	FocusIdx   int
}

// handleNav processes a navigation key for a modal form. Returns true if
// focus changed. Callers should use this in their key dispatch after checking
// for field-specific actions (text input, pickers, toggles).
func (n *modalFormNav) handleNav(scope string, msg tea.KeyMsg, m model) bool {
	keyName := normalizeKeyName(msg.String())
	delta := m.verticalDelta(scope, msg)
	if delta != 0 {
		if delta > 0 {
			n.FocusIdx = (n.FocusIdx + 1) % n.FieldCount
		} else {
			n.FocusIdx = (n.FocusIdx - 1 + n.FieldCount) % n.FieldCount
		}
		return true
	}
	switch keyName {
	case "tab":
		n.FocusIdx = (n.FocusIdx + 1) % n.FieldCount
		return true
	case "shift+tab":
		n.FocusIdx = (n.FocusIdx - 1 + n.FieldCount) % n.FieldCount
		return true
	}
	return false
}

// ---------------------------------------------------------------------------
// Secondary tier: tab-level scope resolution
// ---------------------------------------------------------------------------
// Tab sub-state routing remains in each consumer because it's genuinely
// tab-specific. These helpers centralize the common tab-scope patterns.

// tabScope resolves the active scope for tab-level dispatch (no overlay active).
// Used by footerBindings and commandContextScope for the non-overlay fallthrough.
func (m model) tabScope() string {
	switch m.activeTab {
	case tabDashboard:
		if m.dashCustomEditing {
			return scopeDashboardCustomInput
		}
		if m.dashTimeframeFocus {
			return scopeDashboardTimeframe
		}
		if m.focusedSection >= 0 {
			return scopeDashboardFocused
		}
		return scopeDashboard
	case tabManager:
		if m.managerMode == managerModeAccounts {
			return scopeManager
		}
		return scopeTransactions
	case tabBudget:
		return scopeBudget
	case tabSettings:
		return m.settingsTabScope()
	default:
		return scopeDashboard
	}
}

// settingsTabScope resolves the active scope within the settings tab.
func (m model) settingsTabScope() string {
	// Note: ruleEditorOpen and dryRunOpen are already handled by the overlay
	// table. They should not be active when this function is called. We include
	// these checks defensively for robustness but they should be dead code in
	// normal operation.
	if m.ruleEditorOpen {
		return scopeRuleEditor
	}
	if m.dryRunOpen {
		return scopeDryRunModal
	}
	if m.settMode != settModeNone {
		switch m.settMode {
		case settModeAddCat, settModeEditCat:
			return scopeSettingsModeCat
		case settModeAddTag, settModeEditTag:
			return scopeSettingsModeTag
		}
	}
	if m.confirmAction != confirmActionNone {
		if spec, ok := settingsConfirmSpecFor(m.confirmAction); ok {
			return spec.scope
		}
	}
	if m.settActive {
		return settingsActiveScope(m.settSection)
	}
	return scopeSettingsNav
}
