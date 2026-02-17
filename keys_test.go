package main

import "testing"

func TestKeyRegistryLookupByScope(t *testing.T) {
	r := NewKeyRegistry()

	search := r.Lookup("/", scopeTransactions)
	if search == nil {
		t.Fatal("expected search binding in transactions scope")
	}
	if search.Action != actionSearch {
		t.Fatalf("search action = %q, want %q", search.Action, actionSearch)
	}
	if search.CommandID != "filter:open" {
		t.Fatalf("search commandID = %q, want filter:open", search.CommandID)
	}

	if got := r.Lookup("/", scopeDashboard); got != nil {
		t.Fatalf("did not expect search binding in dashboard scope, got %q", got.Action)
	}

	quit := r.Lookup("q", scopeTransactions)
	if quit == nil {
		t.Fatal("expected quit binding to be available in transactions scope")
	}
	if quit.Action != actionQuit {
		t.Fatalf("quit action = %q, want %q", quit.Action, actionQuit)
	}
	if quit.CommandID != "" {
		t.Fatalf("quit commandID = %q, want empty", quit.CommandID)
	}
}

func TestKeyRegistryNoDuplicateInSameScope(t *testing.T) {
	r := &KeyRegistry{
		bindingsByScope: make(map[string][]*Binding),
		indexByScope:    make(map[string]map[string]*Binding),
	}

	r.Register(Binding{Action: actionAdd, Keys: []string{"x"}, Help: "first", Scopes: []string{"scope_a"}})
	r.Register(Binding{Action: actionEdit, Keys: []string{"x"}, Help: "duplicate", Scopes: []string{"scope_a"}})
	r.Register(Binding{Action: actionEdit, Keys: []string{"x"}, Help: "different scope", Scopes: []string{"scope_b"}})

	a := r.BindingsForScope("scope_a")
	if len(a) != 1 {
		t.Fatalf("scope_a bindings = %d, want 1", len(a))
	}
	if a[0].Action != actionAdd {
		t.Fatalf("scope_a action = %q, want %q", a[0].Action, actionAdd)
	}

	b := r.BindingsForScope("scope_b")
	if len(b) != 1 {
		t.Fatalf("scope_b bindings = %d, want 1", len(b))
	}
	if b[0].Action != actionEdit {
		t.Fatalf("scope_b action = %q, want %q", b[0].Action, actionEdit)
	}
}

func TestKeyRegistryHelpBindings(t *testing.T) {
	r := &KeyRegistry{
		bindingsByScope: make(map[string][]*Binding),
		indexByScope:    make(map[string]map[string]*Binding),
	}
	r.Register(Binding{Action: actionDown, Keys: []string{"j", "down"}, Help: "down", Scopes: []string{"scope_help"}})

	help := r.HelpBindings("scope_help")
	if len(help) != 1 {
		t.Fatalf("help binding count = %d, want 1", len(help))
	}
	entry := help[0].Help()
	if entry.Key != "j" {
		t.Fatalf("help key = %q, want %q", entry.Key, "j")
	}
	if entry.Desc != "down" {
		t.Fatalf("help desc = %q, want %q", entry.Desc, "down")
	}
}

func TestKeyRegistryScopeHelpOrder(t *testing.T) {
	r := NewKeyRegistry()

	transactions := r.HelpBindings(scopeTransactions)
	var txnKeys []string
	for _, b := range transactions {
		txnKeys = append(txnKeys, b.Help().Key)
	}
	// Hidden entries (empty help): S (sort dir), G (bottom), space, shift+up/down, esc, enter, up/down, tab, q
	wantTxn := []string{"/", "ctrl+s", "ctrl+l", "s", "S", "c", "t", "o", "u", "g", "G"}
	if len(txnKeys) != len(wantTxn) {
		t.Fatalf("transactions help count = %d, want %d (%v)", len(txnKeys), len(wantTxn), txnKeys)
	}
	for i := range wantTxn {
		if txnKeys[i] != wantTxn[i] {
			t.Fatalf("transactions help[%d] = %q, want %q", i, txnKeys[i], wantTxn[i])
		}
	}

	filterInput := r.HelpBindings(scopeFilterInput)
	var filterKeys []string
	for _, b := range filterInput {
		filterKeys = append(filterKeys, b.Help().Key)
	}
	// Hidden: esc, enter
	wantFilter := []string{"ctrl+s", "ctrl+l"}
	if len(filterKeys) != len(wantFilter) {
		t.Fatalf("filter input help count = %d, want %d (%v)", len(filterKeys), len(wantFilter), filterKeys)
	}
	for i := range wantFilter {
		if filterKeys[i] != wantFilter[i] {
			t.Fatalf("filter input help[%d] = %q, want %q", i, filterKeys[i], wantFilter[i])
		}
	}

	settingsNav := r.HelpBindings(scopeSettingsNav)
	var navKeys []string
	for _, b := range settingsNav {
		navKeys = append(navKeys, b.Help().Key)
	}
	// Navigation keys (h/l/k/j/enter/tab/q) all hidden, only unique action shown
	wantNav := []string{"i"}
	if len(navKeys) != len(wantNav) {
		t.Fatalf("settings nav help count = %d, want %d (%v)", len(navKeys), len(wantNav), navKeys)
	}
	for i := range wantNav {
		if navKeys[i] != wantNav[i] {
			t.Fatalf("settings nav help[%d] = %q, want %q", i, navKeys[i], wantNav[i])
		}
	}
}

func TestKeyRegistryApplyOverridesScopedReuse(t *testing.T) {
	r := NewKeyRegistry()
	err := r.ApplyOverrides([]shortcutOverride{
		{Scope: scopeTransactions, Action: string(actionQuickCategory), Keys: []string{"CTRL + K"}},
		{Scope: scopeSettingsActiveDBImport, Action: string(actionClearDB), Keys: []string{"ctrl+k"}},
	})
	if err != nil {
		t.Fatalf("ApplyOverrides: %v", err)
	}
	if got := r.Lookup("ctrl+k", scopeTransactions); got == nil || got.Action != actionQuickCategory {
		t.Fatalf("transactions ctrl+k = %+v, want quick_category", got)
	}
	if got := r.Lookup("ctrl+k", scopeSettingsActiveDBImport); got == nil || got.Action != actionClearDB {
		t.Fatalf("settings db ctrl+k = %+v, want clear_db", got)
	}
}

func TestKeyRegistrySearchOverrideAlwaysRetainsSlash(t *testing.T) {
	r := NewKeyRegistry()
	err := r.ApplyOverrides([]shortcutOverride{
		{Scope: scopeTransactions, Action: string(actionSearch), Keys: []string{"f"}},
	})
	if err != nil {
		t.Fatalf("ApplyOverrides: %v", err)
	}
	if got := r.Lookup("/", scopeTransactions); got == nil || got.Action != actionSearch {
		t.Fatalf("transactions / = %+v, want search action", got)
	}
	if got := r.Lookup("f", scopeTransactions); got == nil || got.Action != actionSearch {
		t.Fatalf("transactions f = %+v, want search action", got)
	}
}

func TestKeyRegistryApplyOverridesConflictInScopeFails(t *testing.T) {
	r := NewKeyRegistry()
	err := r.ApplyOverrides([]shortcutOverride{
		{Scope: scopeTransactions, Action: string(actionQuickCategory), Keys: []string{"ctrl+k"}},
		{Scope: scopeTransactions, Action: string(actionSort), Keys: []string{"ctrl+k"}},
	})
	if err == nil {
		t.Fatal("expected conflict error")
	}
}

func TestNormalizeKeyNameCombos(t *testing.T) {
	tests := map[string]string{
		"CTRL + C":    "ctrl+c",
		" shift +tab": "shift+tab",
		"Return":      "enter",
		"SPACEBAR":    "space",
		" ":           "space",
	}
	for in, want := range tests {
		if got := normalizeKeyName(in); got != want {
			t.Fatalf("normalizeKeyName(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestDetailModalNotesBinding(t *testing.T) {
	r := NewKeyRegistry()
	got := r.Lookup("n", scopeDetailModal)
	if got == nil {
		t.Fatal("expected notes binding in detail modal scope")
	}
	if got.Action != actionEdit {
		t.Fatalf("detail modal n action = %q, want %q", got.Action, actionEdit)
	}
}

func TestKeyRegistryPreservesUppercaseActionBindings(t *testing.T) {
	r := NewKeyRegistry()
	gotLower := r.Lookup("s", scopeTransactions)
	if gotLower == nil || gotLower.Action != actionSort {
		t.Fatalf("transactions s = %+v, want sort", gotLower)
	}
	gotUpper := r.Lookup("S", scopeTransactions)
	if gotUpper == nil || gotUpper.Action != actionSortDirection {
		t.Fatalf("transactions S = %+v, want sort_direction", gotUpper)
	}
}

func TestKeyRegistryCommandTriggers(t *testing.T) {
	r := NewKeyRegistry()
	palette := r.Lookup("ctrl+k", scopeGlobal)
	if palette == nil || palette.Action != actionCommandPalette || palette.CommandID != "palette:open" {
		t.Fatalf("ctrl+k = %+v, want command_palette/palette:open", palette)
	}
	colon := r.Lookup(":", scopeGlobal)
	if colon == nil || colon.Action != actionCommandMode || colon.CommandID != "cmd:open" {
		t.Fatalf(": = %+v, want command_mode/cmd:open", colon)
	}
	jump := r.Lookup("v", scopeGlobal)
	if jump == nil || jump.CommandID != "jump:activate" {
		t.Fatalf("v = %+v, want jump:activate", jump)
	}
}

func TestImportPreviewCancelBoundToEscOnly(t *testing.T) {
	r := NewKeyRegistry()
	cancelEsc := r.Lookup("esc", scopeImportPreview)
	if cancelEsc == nil || cancelEsc.Action != actionClose {
		t.Fatalf("esc binding = %+v, want cancel action", cancelEsc)
	}
	if got := r.Lookup("c", scopeImportPreview); got != nil && got.Action == actionClose {
		t.Fatalf("unexpected c cancel binding in import preview: %+v", got)
	}
}

func TestBindingsWithCommandIDReferenceRegisteredCommands(t *testing.T) {
	keys := NewKeyRegistry()
	reg := NewCommandRegistry(keys, nil)
	known := map[string]bool{}
	for _, cmd := range reg.All() {
		known[cmd.ID] = true
	}
	for scope, bindings := range keys.bindingsByScope {
		for _, b := range bindings {
			if b.CommandID == "" {
				continue
			}
			if !known[b.CommandID] {
				t.Fatalf("scope=%s action=%s commandID=%s not registered", scope, b.Action, b.CommandID)
			}
		}
	}
}

func TestCommandsWithScopesHaveBindings(t *testing.T) {
	keys := NewKeyRegistry()
	reg := NewCommandRegistry(keys, nil)
	for _, cmd := range reg.All() {
		if len(cmd.Scopes) == 0 {
			continue
		}
		found := false
		for _, scope := range cmd.Scopes {
			for _, b := range keys.BindingsForScope(scope) {
				if b.CommandID == cmd.ID {
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		if !found {
			t.Fatalf("command %q has scoped availability but no key binding", cmd.ID)
		}
	}
}

func TestGlobalShortcutNonShadowInTabScopes(t *testing.T) {
	keys := NewKeyRegistry()
	tabScopes := []string{
		scopeDashboard,
		scopeDashboardTimeframe,
		scopeDashboardCustomInput,
		scopeDashboardFocused,
		scopeTransactions,
		scopeManager,
		scopeManagerTransactions,
		scopeFilterInput,
		scopeSettingsNav,
		scopeSettingsActiveCategories,
		scopeSettingsActiveTags,
		scopeSettingsActiveRules,
		scopeSettingsActiveFilters,
		scopeSettingsActiveChart,
		scopeSettingsActiveDBImport,
		scopeSettingsActiveImportHist,
	}
	for _, scope := range tabScopes {
		for _, forbidden := range []string{"1", "2", "3", "v"} {
			if got := keys.lookupInScope(forbidden, scope); got != nil {
				t.Fatalf("scope %q shadows global key %q with action %q", scope, forbidden, got.Action)
			}
		}
	}
}

func TestTextInputModalScopesDoNotBindVimNavKeys(t *testing.T) {
	r := NewKeyRegistry()
	// Use the contract-driven list of vim-nav-suppressed scopes.
	vimKeys := []string{"h", "j", "k", "l"}
	for scope, behavior := range modalTextContracts {
		if !behavior.vimNavSuppressed {
			continue
		}
		for _, keyName := range vimKeys {
			b := r.Lookup(keyName, scope)
			if b == nil {
				continue
			}
			switch b.Action {
			case actionUp, actionDown, actionLeft, actionRight:
				t.Fatalf("scope=%s should not bind %q to navigation action=%s (vimNavSuppressed=true in contract)", scope, keyName, b.Action)
			}
		}
	}
}

func TestModalTextContractCompleteness(t *testing.T) {
	// Every overlay entry whose scope is a modal with text input should have
	// a text contract. This test verifies the known text-input modal scopes
	// are all registered.
	requiredScopes := []string{
		scopeRuleEditor,
		scopeFilterEdit,
		scopeSettingsModeCat,
		scopeSettingsModeTag,
		scopeManagerModal,
		scopeDetailModal,
		scopeFilterInput,
	}
	for _, scope := range requiredScopes {
		if !scopeHasTextContract(scope) {
			t.Errorf("scope %s should have a modalTextBehavior entry in modalTextContracts", scope)
		}
	}
}

func TestModalTextContractConsistency(t *testing.T) {
	// Verify that isTextInputModalScope (used by suppressTextModalVimNav)
	// returns true for exactly the scopes with vimNavSuppressed=true.
	for scope, behavior := range modalTextContracts {
		got := isTextInputModalScope(scope)
		if got != behavior.vimNavSuppressed {
			t.Errorf("scope %s: isTextInputModalScope=%v but contract.vimNavSuppressed=%v",
				scope, got, behavior.vimNavSuppressed)
		}
	}
}

func TestDispatchTableOverlayPrecedenceHasUniqueNames(t *testing.T) {
	// Verify that overlay names are unique in the dispatch table.
	seen := map[string]bool{}
	for _, entry := range overlayPrecedence() {
		if seen[entry.name] {
			t.Errorf("duplicate overlay name %q in overlayPrecedence", entry.name)
		}
		seen[entry.name] = true
	}
}

func TestDispatchTableOverlayGuardsAreMutuallyExclusiveWithTabs(t *testing.T) {
	// Verify that the overlay table produces a scope for every known
	// overlay boolean combination on a fresh model, and returns "" when
	// no overlay is active.
	m := newModel()
	m.keys = NewKeyRegistry()

	// No overlay active — should return empty.
	if scope := m.activeOverlayScope(true); scope != "" {
		t.Errorf("expected empty overlay scope on fresh model, got %q", scope)
	}

	// Each overlay guard should produce a scope when set.
	tests := []struct {
		name  string
		setup func(m *model)
		scope string
	}{
		{"jump", func(m *model) { m.jumpModeActive = true }, scopeJumpOverlay},
		{"command_palette", func(m *model) { m.commandOpen = true; m.commandUIKind = commandUIKindPalette }, scopeCommandPalette},
		{"command_colon", func(m *model) { m.commandOpen = true; m.commandUIKind = commandUIKindColon }, scopeCommandMode},
		{"detail", func(m *model) { m.showDetail = true }, scopeDetailModal},
		{"importPreview", func(m *model) { m.importPreviewOpen = true }, scopeImportPreview},
		{"filePicker", func(m *model) { m.importPicking = true }, scopeFilePicker},
		{"catPicker", func(m *model) { m.catPicker = &pickerState{} }, scopeCategoryPicker},
		{"tagPicker", func(m *model) { m.tagPicker = &pickerState{} }, scopeTagPicker},
		{"filterApplyPicker", func(m *model) { m.filterApplyPicker = &pickerState{} }, scopeFilterApplyPicker},
		{"managerActionPicker", func(m *model) { m.managerActionPicker = &pickerState{} }, scopeManagerAccountAction},
		{"filterEdit", func(m *model) { m.filterEditOpen = true }, scopeFilterEdit},
		{"managerModal", func(m *model) { m.managerModalOpen = true }, scopeManagerModal},
		{"dryRun", func(m *model) { m.dryRunOpen = true }, scopeDryRunModal},
		{"ruleEditor", func(m *model) { m.ruleEditorOpen = true }, scopeRuleEditor},
		{"filterInput", func(m *model) { m.filterInputMode = true }, scopeFilterInput},
	}
	for _, tt := range tests {
		fresh := newModel()
		fresh.keys = NewKeyRegistry()
		tt.setup(&fresh)
		got := fresh.activeOverlayScope(true)
		if got != tt.scope {
			t.Errorf("overlay %s: activeOverlayScope(true)=%q, want %q", tt.name, got, tt.scope)
		}
	}
}
