package main

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// Tier 2/3 resilience checks: focus on dispatcher truth and anti-theatre guards.

func TestUpdateDispatcherEscClosesOverlaysInPriorityOrder(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	m := newModel()
	m.ready = true
	m.commandOpen = true
	m.commandUIKind = commandUIKindPalette
	m.showDetail = true
	m.importDupeModal = true
	m.importPicking = true
	m.catPicker = newPicker("Cat", nil, false, "")
	m.tagPicker = newPicker("Tag", nil, true, "Create")
	m.accountNukePicker = newPicker("Nuke", nil, false, "")
	m.managerModalOpen = true
	m.searchMode = true
	m.searchQuery = "keep-me"

	// 1) command UI
	next, _ := m.Update(keyMsg("esc"))
	s1 := next.(model)
	if s1.commandOpen {
		t.Fatal("expected command UI to close first")
	}
	if !s1.showDetail {
		t.Fatal("detail modal should remain while higher-priority layer closes")
	}

	// 2) detail modal
	next, _ = s1.Update(keyMsg("esc"))
	s2 := next.(model)
	if s2.showDetail {
		t.Fatal("expected detail modal to close second")
	}
	if !s2.importDupeModal {
		t.Fatal("dupe modal should still be open")
	}

	// 3) dupe modal
	next, _ = s2.Update(keyMsg("esc"))
	s3 := next.(model)
	if s3.importDupeModal {
		t.Fatal("expected dupe modal to close third")
	}
	if !s3.importPicking {
		t.Fatal("file picker should still be open")
	}

	// 4) file picker
	next, _ = s3.Update(keyMsg("esc"))
	s4 := next.(model)
	if s4.importPicking {
		t.Fatal("expected file picker to close fourth")
	}
	if s4.catPicker == nil {
		t.Fatal("category picker should still be open")
	}

	// 5) category picker
	next, _ = s4.Update(keyMsg("esc"))
	s5 := next.(model)
	if s5.catPicker != nil {
		t.Fatal("expected category picker to close fifth")
	}
	if s5.tagPicker == nil {
		t.Fatal("tag picker should still be open")
	}

	// 6) tag picker
	next, _ = s5.Update(keyMsg("esc"))
	s6 := next.(model)
	if s6.tagPicker != nil {
		t.Fatal("expected tag picker to close sixth")
	}
	if s6.accountNukePicker == nil {
		t.Fatal("account nuke picker should still be open")
	}

	// 7) account nuke picker
	next, _ = s6.Update(keyMsg("esc"))
	s7 := next.(model)
	if s7.accountNukePicker != nil {
		t.Fatal("expected account nuke picker to close seventh")
	}
	if !s7.managerModalOpen {
		t.Fatal("manager modal should still be open")
	}

	// 8) manager modal
	next, _ = s7.Update(keyMsg("esc"))
	s8 := next.(model)
	if s8.managerModalOpen {
		t.Fatal("expected manager modal to close eighth")
	}
	if !s8.searchMode {
		t.Fatal("search mode should still be active")
	}

	// 9) search mode
	next, _ = s8.Update(keyMsg("esc"))
	s9 := next.(model)
	if s9.searchMode {
		t.Fatal("expected search mode to close last")
	}
	if s9.searchQuery != "" {
		t.Fatalf("searchQuery should be cleared when closing search, got %q", s9.searchQuery)
	}
}

func TestUpdateSettingsTextInputShieldsPrintableShortcutKeys(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	m := newModel()
	m.activeTab = tabSettings
	m.ready = true
	m.settMode = settModeAddTag
	m.settTagFocus = 0 // name field focused
	m.settColorIdx = 0
	m.settTagScopeID = 0

	next, _ := m.Update(keyMsg("q"))
	got := next.(model)

	if got.settMode != settModeAddTag {
		t.Fatalf("settings mode changed unexpectedly: %q", got.settMode)
	}
	if got.settInput != "q" {
		t.Fatalf("settInput = %q, want %q", got.settInput, "q")
	}
	if got.settColorIdx != 0 {
		t.Fatalf("settColorIdx changed while typing name: %d", got.settColorIdx)
	}
	if got.settTagScopeID != 0 {
		t.Fatalf("settTagScopeID changed while typing name: %d", got.settTagScopeID)
	}
}

func TestCommandUIOpenBlockedByBusyStatesViaTopLevelUpdate(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	tests := []struct {
		name string
		mut  func(*model)
	}{
		{name: "detail modal", mut: func(m *model) { m.showDetail = true }},
		{name: "dupe modal", mut: func(m *model) { m.importDupeModal = true }},
		{name: "file picker", mut: func(m *model) { m.importPicking = true }},
		{name: "category picker", mut: func(m *model) { m.catPicker = newPicker("Cat", nil, false, "") }},
		{name: "tag picker", mut: func(m *model) { m.tagPicker = newPicker("Tag", nil, true, "Create") }},
		{name: "account nuke picker", mut: func(m *model) { m.accountNukePicker = newPicker("Nuke", nil, false, "") }},
		{name: "manager modal", mut: func(m *model) { m.managerModalOpen = true }},
		{name: "search mode", mut: func(m *model) { m.searchMode = true }},
		{name: "settings edit mode", mut: func(m *model) { m.settMode = settModeAddTag }},
		{name: "settings confirm armed", mut: func(m *model) { m.confirmAction = confirmActionClearDB }},
		{name: "dashboard timeframe focus", mut: func(m *model) { m.dashTimeframeFocus = true }},
		{name: "dashboard custom editing", mut: func(m *model) { m.dashCustomEditing = true }},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := newModel()
			m.ready = true
			tt.mut(&m)

			next, _ := m.Update(keyMsg(":"))
			got := next.(model)
			if got.commandOpen {
				t.Fatalf("command UI opened in blocked state %q via ':'", tt.name)
			}

			next, _ = m.Update(tea.KeyMsg{Type: tea.KeyCtrlK})
			got = next.(model)
			if got.commandOpen {
				t.Fatalf("command UI opened in blocked state %q via ctrl+k", tt.name)
			}
		})
	}
}
