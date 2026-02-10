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
	r.Register(Binding{Action: actionNavigate, Keys: []string{"j/k", "j", "k"}, Help: "navigate", Scopes: []string{"scope_help"}})

	help := r.HelpBindings("scope_help")
	if len(help) != 1 {
		t.Fatalf("help binding count = %d, want 1", len(help))
	}
	entry := help[0].Help()
	if entry.Key != "j/k" {
		t.Fatalf("help key = %q, want %q", entry.Key, "j/k")
	}
	if entry.Desc != "navigate" {
		t.Fatalf("help desc = %q, want %q", entry.Desc, "navigate")
	}
}

func TestKeyRegistryScopeHelpOrder(t *testing.T) {
	r := NewKeyRegistry()

	transactions := r.HelpBindings(scopeTransactions)
	var txnKeys []string
	for _, b := range transactions {
		txnKeys = append(txnKeys, b.Help().Key)
	}
	wantTxn := []string{"/", "s", "f", "c", "t", "space", "shift+up/down", "enter", "j/k", "tab", "q"}
	if len(txnKeys) != len(wantTxn) {
		t.Fatalf("transactions help count = %d, want %d (%v)", len(txnKeys), len(wantTxn), txnKeys)
	}
	for i := range wantTxn {
		if txnKeys[i] != wantTxn[i] {
			t.Fatalf("transactions help[%d] = %q, want %q", i, txnKeys[i], wantTxn[i])
		}
	}

	settingsNav := r.HelpBindings(scopeSettingsNav)
	var navKeys []string
	for _, b := range settingsNav {
		navKeys = append(navKeys, b.Help().Key)
	}
	wantNav := []string{"h/l", "j/k", "enter", "i", "tab", "q"}
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
