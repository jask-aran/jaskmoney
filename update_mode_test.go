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
	if got4.showDetail {
		t.Fatal("detail modal should close on esc while notes editor is active")
	}
	if got4.detailEditing != "" {
		t.Fatalf("detailEditing should clear when closing modal, got %q", got4.detailEditing)
	}

	got4.filterInputMode = true
	next, _ = got4.updateFilterInput(keyMsg("a"))
	got6 := next.(model)
	if got6.filterInput != "a" {
		t.Fatalf("filterInput = %q, want a", got6.filterInput)
	}
	clearSearchKey := got6.primaryActionKey(scopeFilterInput, actionClearSearch, "esc")
	next, _ = got6.updateFilterInput(keyMsg(clearSearchKey))
	got7 := next.(model)
	if got7.filterInputMode {
		t.Fatal("expected filter input mode to exit on esc")
	}
	if got7.filterInput != "" {
		t.Fatalf("filterInput should be cleared, got %q", got7.filterInput)
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

func TestJumpModeToggleKeyClosesOverlay(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabManager
	m.focusedSection = sectionManagerTransactions

	next, _ := m.Update(keyMsg("v"))
	got := next.(model)
	if !got.jumpModeActive {
		t.Fatal("expected jump mode to open on first v")
	}

	next, _ = got.Update(keyMsg("v"))
	got2 := next.(model)
	if got2.jumpModeActive {
		t.Fatal("expected jump mode to close on second v")
	}
	if got2.focusedSection != sectionManagerTransactions {
		t.Fatalf("focusedSection = %d, want %d", got2.focusedSection, sectionManagerTransactions)
	}
}

func TestFilterReservedJumpTargetKeysExcludesV(t *testing.T) {
	in := []jumpTarget{
		{Key: "v", Label: "Bad Lower", Section: 1},
		{Key: "V", Label: "Bad Upper", Section: 2},
		{Key: "a", Label: "Accounts", Section: 3},
	}
	got := filterReservedJumpTargetKeys(in)
	if len(got) != 1 {
		t.Fatalf("filtered targets = %d, want 1", len(got))
	}
	if normalizeKeyName(got[0].Key) != "a" {
		t.Fatalf("remaining target key = %q, want a", got[0].Key)
	}
}

func TestSettingsJumpTargetsIncludeCategoriesAndTags(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabSettings

	targets := m.jumpTargetsForActiveTab()
	if len(targets) != 5 {
		t.Fatalf("settings jump target count = %d, want 5", len(targets))
	}

	byKey := make(map[string]jumpTarget, len(targets))
	for _, target := range targets {
		byKey[normalizeKeyName(target.Key)] = target
	}

	if _, ok := byKey["i"]; ok {
		t.Fatal("unexpected imports jump target")
	}
	if got, ok := byKey["c"]; !ok || got.Section != sectionSettingsCategories {
		t.Fatalf("c target = %+v, want section %d", got, sectionSettingsCategories)
	}
	if got, ok := byKey["t"]; !ok || got.Section != sectionSettingsTags {
		t.Fatalf("t target = %+v, want section %d", got, sectionSettingsTags)
	}
	if got, ok := byKey["r"]; !ok || got.Section != sectionSettingsRules {
		t.Fatalf("r target = %+v, want section %d", got, sectionSettingsRules)
	}
	if got, ok := byKey["d"]; !ok || got.Section != sectionSettingsDatabase {
		t.Fatalf("d target = %+v, want section %d", got, sectionSettingsDatabase)
	}
	if got, ok := byKey["w"]; !ok || got.Section != sectionSettingsViews {
		t.Fatalf("w target = %+v, want section %d", got, sectionSettingsViews)
	}
}

func TestSettingsJumpKeyFocusesCategories(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabSettings
	m.jumpModeActive = true
	m.focusedSection = sectionSettingsDatabase
	m.settColumn = settColRight
	m.settSection = settSecDBImport

	next, _ := m.updateJumpOverlay(keyMsg("c"))
	got := next.(model)

	if got.jumpModeActive {
		t.Fatal("jump mode should close after selecting a settings target")
	}
	if got.focusedSection != sectionSettingsCategories {
		t.Fatalf("focusedSection = %d, want %d", got.focusedSection, sectionSettingsCategories)
	}
	if got.settColumn != settColLeft || got.settSection != settSecCategories {
		t.Fatalf("settings focus = (col=%d, sec=%d), want (col=%d, sec=%d)", got.settColumn, got.settSection, settColLeft, settSecCategories)
	}
}

func TestSlashFromManagerAccountsSwitchesToTransactionsAndOpensFilter(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabManager
	m.managerMode = managerModeAccounts
	m.focusedSection = sectionManagerAccounts
	m.accounts = []account{{id: 1, name: "ANZ", acctType: "credit"}}

	next, _ := m.Update(keyMsg("/"))
	got := next.(model)
	if got.managerMode != managerModeTransactions {
		t.Fatalf("managerMode = %d, want %d", got.managerMode, managerModeTransactions)
	}
	if got.focusedSection != sectionManagerTransactions {
		t.Fatalf("focusedSection = %d, want %d", got.focusedSection, sectionManagerTransactions)
	}
	if !got.filterInputMode {
		t.Fatal("expected filter input mode enabled")
	}
}

func TestManagerAccountsUseHorizontalNavigationWithoutWrap(t *testing.T) {
	m := newModel()
	m.activeTab = tabManager
	m.managerMode = managerModeAccounts
	m.accounts = []account{
		{id: 1, name: "A"},
		{id: 2, name: "B"},
		{id: 3, name: "C"},
	}
	m.managerCursor = 1
	m.managerSelectedID = 2

	next, _ := m.updateManager(keyMsg("right"))
	got := next.(model)
	if got.managerCursor != 2 || got.managerSelectedID != 3 {
		t.Fatalf("after right: cursor=%d selected=%d, want 2/3", got.managerCursor, got.managerSelectedID)
	}
	next, _ = got.updateManager(keyMsg("right"))
	got2 := next.(model)
	if got2.managerCursor != 2 {
		t.Fatalf("cursor should clamp at end, got %d", got2.managerCursor)
	}
	next, _ = got2.updateManager(keyMsg("left"))
	got3 := next.(model)
	if got3.managerCursor != 1 || got3.managerSelectedID != 2 {
		t.Fatalf("after left: cursor=%d selected=%d, want 1/2", got3.managerCursor, got3.managerSelectedID)
	}
}

func TestManagerModalTextInputShieldsShortcutKeys(t *testing.T) {
	m := newModel()
	m.openManagerAccountModal(true, nil)
	m.managerEditFocus = 0 // name field

	next, _ := m.updateManagerModal(keyMsg("h"))
	got := next.(model)
	if got.managerEditName != "h" {
		t.Fatalf("managerEditName = %q, want h", got.managerEditName)
	}
	if got.managerEditFocus != 0 {
		t.Fatalf("managerEditFocus = %d, want 0", got.managerEditFocus)
	}

	next, _ = got.updateManagerModal(keyMsg("j"))
	got2 := next.(model)
	if got2.managerEditName != "hj" {
		t.Fatalf("managerEditName = %q, want hj", got2.managerEditName)
	}
	if got2.managerEditFocus != 0 {
		t.Fatalf("managerEditFocus should remain 0 while typing, got %d", got2.managerEditFocus)
	}

	next, _ = got2.updateManagerModal(keyMsg("s"))
	got3 := next.(model)
	if got3.managerEditName != "hjs" {
		t.Fatalf("managerEditName = %q, want hjs", got3.managerEditName)
	}

	next, _ = got3.updateManagerModal(keyMsg("down"))
	got4 := next.(model)
	if got4.managerEditFocus != 1 {
		t.Fatalf("managerEditFocus after down = %d, want 1", got4.managerEditFocus)
	}
}

func TestFilterInputCursorUsesArrowKeysAndTreatsHLAsText(t *testing.T) {
	m := newModel()
	m.filterInputMode = true
	m.filterInput = "abc"
	m.filterInputCursor = 3
	m.reparseFilterInput()

	next, _ := m.updateFilterInput(keyMsg("left"))
	got := next.(model)
	if got.filterInputCursor != 2 {
		t.Fatalf("cursor after left = %d, want 2", got.filterInputCursor)
	}

	next, _ = got.updateFilterInput(keyMsg("X"))
	got2 := next.(model)
	if got2.filterInput != "abXc" {
		t.Fatalf("filterInput = %q, want abXc", got2.filterInput)
	}
	if got2.filterInputCursor != 3 {
		t.Fatalf("cursor after insert = %d, want 3", got2.filterInputCursor)
	}

	next, _ = got2.updateFilterInput(keyMsg("h"))
	got3 := next.(model)
	if got3.filterInput != "abXhc" {
		t.Fatalf("filterInput = %q, want abXhc", got3.filterInput)
	}
}

func TestManagerAccountStripScopeLabelSimplified(t *testing.T) {
	m := newModel()
	m.accounts = []account{
		{id: 1, name: "ANZ", acctType: "credit", txnCount: 3},
		{id: 2, name: "CBA", acctType: "debit", txnCount: 0},
	}
	out := renderManagerAccountStrip(m, false, 80)
	if strings.Contains(out, "Scope:") {
		t.Fatalf("scope label should not include prefix, got %q", out)
	}
	if !strings.Contains(out, "3") {
		t.Fatalf("expected transaction count in strip, got %q", out)
	}
	if !strings.Contains(out, "Empty") {
		t.Fatalf("expected empty marker in strip, got %q", out)
	}
}

func TestFilterSaveRequiresAppliedExpression(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	m := newModel()
	m.filterInputMode = true
	m.filterInput = "cat:Groceries"
	m.filterInputCursor = len(m.filterInput)
	m.reparseFilterInput()

	next, _ := m.updateFilterInput(keyMsg("ctrl+s"))
	got := next.(model)
	if len(got.savedFilters) != 0 {
		t.Fatalf("saved filters = %d, want 0 before apply", len(got.savedFilters))
	}
	if !got.statusErr || !strings.Contains(got.status, "Apply filter with Enter") {
		t.Fatalf("expected save gating error, got statusErr=%t status=%q", got.statusErr, got.status)
	}

	next, _ = got.updateFilterInput(keyMsg("enter"))
	got2 := next.(model)
	if !got2.filterInputMode {
		t.Fatal("filter input mode should remain active after enter apply")
	}
	if got2.filterLastApplied == "" {
		t.Fatal("expected filterLastApplied to be set after enter")
	}
	next, _ = got2.updateFilterInput(keyMsg("ctrl+s"))
	got3 := next.(model)
	if len(got3.savedFilters) != 1 {
		t.Fatalf("saved filters = %d, want 1 after apply", len(got3.savedFilters))
	}
}

func TestFilterInputAllowsColonAndPreventsGlobalShortcutLeak(t *testing.T) {
	m := newModel()
	m.filterInputMode = true
	m.activeTab = tabManager

	next, _ := m.Update(keyMsg(":"))
	got := next.(model)
	if got.filterInput != ":" {
		t.Fatalf("filterInput = %q, want :", got.filterInput)
	}
	if got.commandOpen {
		t.Fatal("command mode should not open while typing in filter input")
	}

	next, _ = got.Update(keyMsg("v"))
	got2 := next.(model)
	if got2.filterInput != ":v" {
		t.Fatalf("filterInput = %q, want :v", got2.filterInput)
	}
	if got2.jumpModeActive {
		t.Fatal("jump mode should not activate while typing in filter input")
	}

	next, _ = got2.Update(keyMsg("1"))
	got3 := next.(model)
	if got3.activeTab != tabManager {
		t.Fatalf("activeTab changed during filter typing: got %d", got3.activeTab)
	}
}

func TestEscInTransactionsDoesNotClearAccountScope(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	accA, err := insertAccount(db, "ANZ", "debit", true)
	if err != nil {
		t.Fatalf("insert account A: %v", err)
	}
	accB, err := insertAccount(db, "CBA", "debit", true)
	if err != nil {
		t.Fatalf("insert account B: %v", err)
	}

	m := newModel()
	m.db = db
	m.ready = true
	m.activeTab = tabManager
	m.managerMode = managerModeAccounts
	m.accounts = []account{
		{id: accA, name: "ANZ", acctType: "debit"},
		{id: accB, name: "CBA", acctType: "debit"},
	}
	m.managerCursor = 0
	m.managerSelectedID = accA

	next, cmd := m.updateManager(keyMsg("space"))
	got := next.(model)
	if cmd != nil {
		msg := cmd()
		next, _ = got.Update(msg)
		got = next.(model)
	}
	if len(got.filterAccounts) == 0 {
		t.Fatal("expected scoped account selection after toggle")
	}

	next, _ = got.updateManager(keyMsg("esc"))
	got2 := next.(model)
	if got2.managerMode != managerModeTransactions {
		t.Fatalf("managerMode = %d, want transactions", got2.managerMode)
	}

	next, _ = got2.Update(keyMsg("esc"))
	got3 := next.(model)
	if len(got3.filterAccounts) == 0 {
		t.Fatal("account scope should remain after esc in transactions")
	}
}

func TestDeleteInAccountsOpensActionModal(t *testing.T) {
	m := newModel()
	m.activeTab = tabManager
	m.managerMode = managerModeAccounts
	m.accounts = []account{{id: 1, name: "ANZ", acctType: "debit", txnCount: 2}}

	next, _ := m.updateManager(keyMsg("del"))
	got := next.(model)
	if got.managerActionPicker == nil {
		t.Fatal("expected manager action picker to open")
	}
}
