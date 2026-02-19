package main

import (
	"strings"
	"testing"
)

func TestPhase7ActiveInteractionContractResolvesScopes(t *testing.T) {
	tests := []struct {
		name      string
		setup     func(*model)
		wantScope string
	}{
		{name: "jump", setup: func(m *model) { m.jumpModeActive = true }, wantScope: scopeJumpOverlay},
		{name: "command_palette", setup: func(m *model) { m.commandOpen = true; m.commandUIKind = commandUIKindPalette }, wantScope: scopeCommandPalette},
		{name: "command_colon", setup: func(m *model) { m.commandOpen = true; m.commandUIKind = commandUIKindColon }, wantScope: scopeCommandMode},
		{name: "detail", setup: func(m *model) { m.showDetail = true }, wantScope: scopeDetailModal},
		{name: "import_preview", setup: func(m *model) { m.importPreviewOpen = true }, wantScope: scopeImportPreview},
		{name: "file_picker", setup: func(m *model) { m.importPicking = true }, wantScope: scopeFilePicker},
		{name: "category_picker", setup: func(m *model) { m.catPicker = &pickerState{} }, wantScope: scopeCategoryPicker},
		{name: "tag_picker", setup: func(m *model) { m.tagPicker = &pickerState{} }, wantScope: scopeTagPicker},
		{name: "quick_offset", setup: func(m *model) { m.allocationModalOpen = true }, wantScope: scopeQuickOffset},
		{name: "filter_apply_picker", setup: func(m *model) { m.filterApplyPicker = &pickerState{} }, wantScope: scopeFilterApplyPicker},
		{name: "manager_action_picker", setup: func(m *model) { m.managerActionPicker = &pickerState{} }, wantScope: scopeManagerAccountAction},
		{name: "filter_edit", setup: func(m *model) { m.filterEditOpen = true }, wantScope: scopeFilterEdit},
		{name: "manager_modal", setup: func(m *model) { m.managerModalOpen = true }, wantScope: scopeManagerModal},
		{name: "dry_run", setup: func(m *model) { m.dryRunOpen = true }, wantScope: scopeDryRunModal},
		{name: "rule_editor", setup: func(m *model) { m.ruleEditorOpen = true }, wantScope: scopeRuleEditor},
		{name: "filter_input", setup: func(m *model) { m.filterInputMode = true }, wantScope: scopeFilterInput},
		{name: "dashboard_default", setup: func(m *model) { m.activeTab = tabDashboard }, wantScope: scopeDashboard},
		{name: "dashboard_timeframe", setup: func(m *model) { m.activeTab = tabDashboard; m.dashTimeframeFocus = true }, wantScope: scopeDashboardTimeframe},
		{name: "dashboard_custom_input", setup: func(m *model) { m.activeTab = tabDashboard; m.dashCustomEditing = true }, wantScope: scopeDashboardCustomInput},
		{name: "dashboard_focused", setup: func(m *model) { m.activeTab = tabDashboard; m.focusedSection = sectionDashboardNetCashflow }, wantScope: scopeDashboardFocused},
		{name: "manager_accounts", setup: func(m *model) { m.activeTab = tabManager; m.managerMode = managerModeAccounts }, wantScope: scopeManager},
		{name: "manager_transactions", setup: func(m *model) { m.activeTab = tabManager; m.managerMode = managerModeTransactions }, wantScope: scopeTransactions},
		{name: "budget", setup: func(m *model) { m.activeTab = tabBudget }, wantScope: scopeBudget},
		{name: "settings_nav", setup: func(m *model) { m.activeTab = tabSettings }, wantScope: scopeSettingsNav},
		{name: "settings_mode_tag", setup: func(m *model) { m.activeTab = tabSettings; m.settMode = settModeAddTag }, wantScope: scopeSettingsModeTag},
		{name: "settings_active_rules", setup: func(m *model) { m.activeTab = tabSettings; m.settActive = true; m.settSection = settSecRules }, wantScope: scopeSettingsActiveRules},
		{name: "settings_confirm", setup: func(m *model) { m.activeTab = tabSettings; m.confirmAction = confirmActionDeleteCategory }, wantScope: scopeSettingsActiveCategories},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := newModel()
			m.keys = NewKeyRegistry()
			tt.setup(&m)
			got := m.activeInteractionContract()
			if got.Scope != tt.wantScope {
				t.Fatalf("activeInteractionContract().Scope=%q, want %q", got.Scope, tt.wantScope)
			}
			if !scopeHasInteractionContract(got.Scope) {
				t.Fatalf("missing interaction contract for scope %q", got.Scope)
			}
		})
	}
}

func TestPhase7InteractionContractsIncludeModalTextScopes(t *testing.T) {
	for scope := range modalTextContracts {
		if !scopeHasInteractionContract(scope) {
			t.Fatalf("modal text scope %q missing interaction contract", scope)
		}
		contract := interactionContractForScope(scope)
		if !contractHasIntent(contract, IntentCancel) {
			t.Fatalf("modal text scope %q contract missing cancel intent", scope)
		}
	}
}

func TestPhase7InteractionContractVisibleHintsMapToBoundKeys(t *testing.T) {
	keys := NewKeyRegistry()

	for scope, contract := range interactionContracts {
		for _, hint := range contract.Hints {
			if hint.Omit {
				continue
			}
			action, ok := interactionActionForHint(hint)
			if !ok {
				t.Fatalf("scope=%q intent=%q has no action mapping", scope, hint.Intent)
			}
			if _, ok := primaryKeyForScopeAction(keys, scope, action); !ok {
				t.Fatalf("scope=%q intent=%q action=%q has no key binding", scope, hint.Intent, action)
			}
		}
	}

	confirmActions := []settingsConfirmAction{
		confirmActionDeleteCategory,
		confirmActionDeleteTag,
		confirmActionDeleteRule,
		confirmActionDeleteFilter,
		confirmActionClearDB,
	}
	for _, action := range confirmActions {
		spec, ok := settingsConfirmSpecFor(action)
		if !ok {
			t.Fatalf("settingsConfirmSpecFor(%q) missing", action)
		}
		contract := settingsConfirmInteractionContract(spec)
		for _, hint := range contract.Hints {
			if hint.Omit {
				continue
			}
			mapped, ok := interactionActionForHint(hint)
			if !ok {
				t.Fatalf("confirm scope=%q intent=%q missing action mapping", contract.Scope, hint.Intent)
			}
			if _, ok := primaryKeyForScopeAction(keys, contract.Scope, mapped); !ok {
				t.Fatalf("confirm scope=%q intent=%q action=%q has no key binding", contract.Scope, hint.Intent, mapped)
			}
		}
	}
}

func TestPhase7InteractionContractKindDefaults(t *testing.T) {
	for scope, contract := range interactionContracts {
		has := map[InteractionIntent]bool{}
		for _, hint := range contract.Hints {
			has[hint.Intent] = true
		}

		switch contract.Kind {
		case ContextList:
			if !has[IntentMovePrev] || !has[IntentMoveNext] {
				t.Fatalf("scope=%q list contract missing move intents", scope)
			}
			if !has[IntentCancel] {
				t.Fatalf("scope=%q list contract missing cancel intent", scope)
			}
			if !has[IntentSelect] && !has[IntentApply] {
				t.Fatalf("scope=%q list contract missing select/apply intent", scope)
			}
		case ContextForm:
			if !has[IntentCancel] {
				t.Fatalf("scope=%q form contract missing cancel intent", scope)
			}
			if !has[IntentConfirm] && !has[IntentSave] {
				t.Fatalf("scope=%q form contract missing confirm/save intent", scope)
			}
		case ContextViewer:
			if !has[IntentCancel] {
				t.Fatalf("scope=%q viewer contract missing cancel intent", scope)
			}
		case ContextInlineEdit:
			if !has[IntentCancel] {
				t.Fatalf("scope=%q inline_edit contract missing cancel intent", scope)
			}
			if !has[IntentApply] && !has[IntentSave] && !has[IntentConfirm] {
				t.Fatalf("scope=%q inline_edit contract missing apply/save/confirm intent", scope)
			}
		case ContextWorkflow:
			if len(contract.Hints) == 0 {
				t.Fatalf("scope=%q workflow contract should declare at least one hint", scope)
			}
		default:
			t.Fatalf("scope=%q has unknown context kind %q", scope, contract.Kind)
		}
	}
}

func TestPhase7RenderFooterFromContract(t *testing.T) {
	m := newModel()
	m.width = 140
	keys := NewKeyRegistry()

	got := m.renderFooter(renderFooterFromContract(interactionContractForScope(scopeDashboard), keys))
	if !strings.Contains(got, "prev month") {
		t.Fatal("dashboard footer missing prev month hint")
	}
	if !strings.Contains(got, "next month") {
		t.Fatal("dashboard footer missing next month hint")
	}
	if !strings.Contains(got, "this month") {
		t.Fatal("dashboard footer missing this month hint")
	}
}

func TestPhase7RenderFooterFromContractOmitsHiddenHints(t *testing.T) {
	keys := NewKeyRegistry()
	bindings := renderFooterFromContract(interactionContractForScope(scopeCategoryPicker), keys)
	if len(bindings) != 0 {
		t.Fatalf("category picker footer hints = %d, want 0", len(bindings))
	}
}
