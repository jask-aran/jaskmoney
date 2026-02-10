package main

import (
	"strings"
	"testing"
)

func typeDashboardInput(t *testing.T, m model, s string) model {
	t.Helper()
	for _, r := range s {
		next, _ := m.updateDashboard(keyMsg(string(r)))
		m = next.(model)
	}
	return m
}

func TestDashboardSelectPresetFlow(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	m := newModel()
	m.activeTab = tabDashboard
	m.ready = true
	m.dashTimeframe = dashTimeframeThisMonth

	next, _ := m.updateDashboard(keyMsg("d"))
	got := next.(model)
	if !got.dashTimeframeFocus {
		t.Fatal("expected timeframe focus to be enabled")
	}
	if got.dashTimeframeCursor != dashTimeframeThisMonth {
		t.Fatalf("timeframe cursor = %d, want %d", got.dashTimeframeCursor, dashTimeframeThisMonth)
	}

	next, _ = got.updateDashboard(keyMsg("l"))
	got2 := next.(model)
	if got2.dashTimeframeCursor != (dashTimeframeThisMonth+1)%dashTimeframeCount {
		t.Fatalf("timeframe cursor = %d, want %d", got2.dashTimeframeCursor, (dashTimeframeThisMonth+1)%dashTimeframeCount)
	}

	next, cmd := got2.updateDashboard(keyMsg("enter"))
	got3 := next.(model)
	if got3.dashTimeframeFocus {
		t.Fatal("expected timeframe focus to be disabled after select")
	}
	if got3.statusErr {
		t.Fatalf("statusErr should be false, status=%q", got3.status)
	}
	if !strings.Contains(got3.status, "Dashboard timeframe:") {
		t.Fatalf("unexpected status: %q", got3.status)
	}
	if cmd == nil {
		t.Fatal("expected save settings command")
	}
	if _, ok := cmd().(settingsSavedMsg); !ok {
		t.Fatalf("expected settingsSavedMsg from save command, got %T", cmd())
	}
}

func TestDashboardCustomTimeframeFlow(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	m := newModel()
	m.activeTab = tabDashboard
	m.ready = true
	m.dashTimeframeFocus = true
	m.dashTimeframeCursor = dashTimeframeCustom

	next, _ := m.updateDashboard(keyMsg("enter"))
	got := next.(model)
	if !got.dashCustomEditing {
		t.Fatal("expected custom editing mode")
	}
	if got.status != "Custom timeframe: enter start date (YYYY-MM-DD)." {
		t.Fatalf("unexpected status: %q", got.status)
	}

	got = typeDashboardInput(t, got, "2026-02-01")
	next, _ = got.updateDashboard(keyMsg("enter"))
	got2 := next.(model)
	if got2.dashCustomStart != "2026-02-01" {
		t.Fatalf("dashCustomStart = %q, want 2026-02-01", got2.dashCustomStart)
	}
	if got2.dashCustomInput != "" {
		t.Fatalf("dashCustomInput should be cleared, got %q", got2.dashCustomInput)
	}

	got2 = typeDashboardInput(t, got2, "2026-02-10")
	next, cmd := got2.updateDashboard(keyMsg("enter"))
	got3 := next.(model)
	if got3.dashTimeframe != dashTimeframeCustom {
		t.Fatalf("dashTimeframe = %d, want custom", got3.dashTimeframe)
	}
	if got3.dashCustomEditing || got3.dashTimeframeFocus {
		t.Fatal("expected custom editing and focus to be disabled")
	}
	if got3.statusErr {
		t.Fatalf("statusErr should be false, status=%q", got3.status)
	}
	if cmd == nil {
		t.Fatal("expected save settings command")
	}
}

func TestDashboardCustomTimeframeRejectsInvalidRange(t *testing.T) {
	m := newModel()
	m.activeTab = tabDashboard
	m.ready = true
	m.dashCustomEditing = true
	m.dashTimeframeFocus = true
	m.dashCustomStart = "2026-02-10"
	m.dashCustomInput = "2026-02-01"

	next, _ := m.updateDashboard(keyMsg("enter"))
	got := next.(model)
	if !got.statusErr {
		t.Fatalf("expected error status, got %q", got.status)
	}
	if !strings.Contains(got.status, "End date must be on or after start date.") {
		t.Fatalf("unexpected status: %q", got.status)
	}
	if got.dashCustomEnd != "" {
		t.Fatalf("dashCustomEnd should be cleared, got %q", got.dashCustomEnd)
	}
}

func TestDetailAndSearchFlows(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	m := newModel()
	m.ready = true
	catID := 1
	txn := transaction{id: 42, categoryID: &catID, notes: "seed"}
	m.rows = []transaction{txn}
	m.categories = []category{{id: 1, name: "Groceries"}}

	m.openDetail(txn)
	if !m.showDetail {
		t.Fatal("expected detail modal open")
	}
	if m.detailCatCursor != 0 {
		t.Fatalf("detailCatCursor = %d, want 0", m.detailCatCursor)
	}
	if got := m.findDetailTxn(); got == nil || got.id != txn.id {
		t.Fatalf("findDetailTxn = %+v, want txn id %d", got, txn.id)
	}

	editKey := m.primaryActionKey(scopeDetailModal, actionEdit, "n")
	next, _ := m.updateDetail(keyMsg(editKey))
	got := next.(model)
	if got.detailEditing != "notes" {
		t.Fatalf("detailEditing = %q, want notes", got.detailEditing)
	}

	next, _ = got.updateDetail(keyMsg("x"))
	got2 := next.(model)
	if got2.detailNotes != "seedx" {
		t.Fatalf("detailNotes = %q, want %q", got2.detailNotes, "seedx")
	}

	next, _ = got2.updateDetail(keyMsg("backspace"))
	got3 := next.(model)
	if got3.detailNotes != "seed" {
		t.Fatalf("detailNotes after backspace = %q, want seed", got3.detailNotes)
	}

	next, _ = got3.updateDetail(keyMsg("esc"))
	got4 := next.(model)
	if got4.detailEditing != "" {
		t.Fatalf("detailEditing should close, got %q", got4.detailEditing)
	}

	next, cmd := got4.updateDetail(keyMsg("enter"))
	got5 := next.(model)
	if cmd != nil {
		t.Fatal("expected nil cmd when saving detail without db")
	}
	if !got5.showDetail {
		t.Fatal("detail modal should remain open without DB")
	}

	got5.searchMode = true
	next, _ = got5.updateSearch(keyMsg("a"))
	got6 := next.(model)
	if got6.searchQuery != "a" {
		t.Fatalf("searchQuery = %q, want a", got6.searchQuery)
	}
	clearSearchKey := got6.primaryActionKey(scopeSearch, actionClearSearch, "esc")
	next, _ = got6.updateSearch(keyMsg(clearSearchKey))
	got7 := next.(model)
	if got7.searchMode {
		t.Fatal("expected search mode to exit on esc")
	}
	if got7.searchQuery != "" {
		t.Fatalf("searchQuery should be cleared, got %q", got7.searchQuery)
	}
}

func TestManagerAndDupeModalActionFlows(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabManager
	m.managerMode = managerModeAccounts
	m.height = 24
	m.width = 100

	next, _ := m.updateManager(keyMsg("esc"))
	got := next.(model)
	if got.managerMode != managerModeTransactions {
		t.Fatalf("managerMode = %d, want transactions mode", got.managerMode)
	}

	got.importDupeModal = true
	got.importDupeFile = "sample.csv"
	got.basePath = t.TempDir()
	got.formats = defaultFormats()
	next, cmd := got.updateDupeModal(keyMsg("a"))
	got2 := next.(model)
	if got2.importDupeModal {
		t.Fatal("dupe modal should close on import-all action")
	}
	if got2.status != "Importing all (including duplicates)..." {
		t.Fatalf("unexpected status: %q", got2.status)
	}
	if cmd == nil {
		t.Fatal("expected ingest command for import-all action")
	}

	got2.importDupeModal = true
	next, cmd = got2.updateDupeModal(keyMsg("s"))
	got3 := next.(model)
	if got3.importDupeModal {
		t.Fatal("dupe modal should close on skip-dupes action")
	}
	if got3.status != "Importing (skipping duplicates)..." {
		t.Fatalf("unexpected status: %q", got3.status)
	}
	if cmd == nil {
		t.Fatal("expected ingest command for skip-dupes action")
	}
}
