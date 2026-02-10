package main

import (
	"testing"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

// ---------------------------------------------------------------------------
// Test data helpers
// ---------------------------------------------------------------------------

func testTransactions() []transaction {
	catGroceries := 2
	catDining := 3
	catTransport := 4
	return []transaction{
		{id: 1, dateRaw: "03/02/2026", dateISO: "2026-02-03", amount: -20.00, description: "DAN MURPHYS", categoryID: &catDining, categoryName: "Dining & Drinks", categoryColor: "#fab387"},
		{id: 2, dateRaw: "03/02/2026", dateISO: "2026-02-03", amount: 203.92, description: "PAYMENT RECEIVED", categoryID: nil, categoryName: "Uncategorised", categoryColor: "#7f849c"},
		{id: 3, dateRaw: "04/02/2026", dateISO: "2026-02-04", amount: -55.30, description: "WOOLWORTHS 1234", categoryID: &catGroceries, categoryName: "Groceries", categoryColor: "#94e2d5"},
		{id: 4, dateRaw: "15/01/2026", dateISO: "2026-01-15", amount: -12.50, description: "UBER TRIP", categoryID: &catTransport, categoryName: "Transport", categoryColor: "#89b4fa"},
		{id: 5, dateRaw: "20/12/2025", dateISO: "2025-12-20", amount: 500.00, description: "SALARY PAYMENT", categoryID: nil, categoryName: "Uncategorised", categoryColor: "#7f849c"},
	}
}

// ---------------------------------------------------------------------------
// Search tests
// ---------------------------------------------------------------------------

func TestMatchesSearchEmptyQuery(t *testing.T) {
	txn := transaction{description: "anything"}
	if !matchesSearch(txn, "") {
		t.Error("empty query should match everything")
	}
}

func TestMatchesSearchDescription(t *testing.T) {
	txn := transaction{description: "WOOLWORTHS 1234", categoryName: "Groceries", dateISO: "2026-02-04"}
	tests := []struct {
		query string
		want  bool
	}{
		{"woolworths", true},
		{"WOOLWORTHS", true},
		{"1234", true},
		{"walmart", false},
		{"groc", true},    // matches category name
		{"2026-02", true}, // matches date
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			if got := matchesSearch(txn, tt.query); got != tt.want {
				t.Errorf("matchesSearch(%q) = %v, want %v", tt.query, got, tt.want)
			}
		})
	}
}

func TestFilteredRowsSearch(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, "woolworths", nil, nil, sortByDate, false)
	if len(result) != 1 {
		t.Fatalf("expected 1 result for 'woolworths', got %d", len(result))
	}
	if result[0].id != 3 {
		t.Errorf("expected transaction 3, got %d", result[0].id)
	}
}

// ---------------------------------------------------------------------------
// Sort tests
// ---------------------------------------------------------------------------

func TestSortByDateAscending(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, "", nil, nil, sortByDate, true)
	if len(result) != 5 {
		t.Fatalf("expected 5 rows, got %d", len(result))
	}
	// Ascending: oldest first
	if result[0].dateISO != "2025-12-20" {
		t.Errorf("first row dateISO = %q, want %q", result[0].dateISO, "2025-12-20")
	}
	if result[4].dateISO != "2026-02-04" {
		t.Errorf("last row dateISO = %q, want %q", result[4].dateISO, "2026-02-04")
	}
}

func TestSortByDateDescending(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, "", nil, nil, sortByDate, false)
	// Descending: newest first
	if result[0].dateISO != "2026-02-04" {
		t.Errorf("first row dateISO = %q, want %q", result[0].dateISO, "2026-02-04")
	}
}

func TestSortByAmount(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, "", nil, nil, sortByAmount, true)
	// Ascending: most negative first
	if result[0].amount != -55.30 {
		t.Errorf("first row amount = %.2f, want -55.30", result[0].amount)
	}
	if result[4].amount != 500.00 {
		t.Errorf("last row amount = %.2f, want 500.00", result[4].amount)
	}
}

func TestSortByCategory(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, "", nil, nil, sortByCategory, true)
	// Ascending alphabetical by category name
	if result[0].categoryName != "Dining & Drinks" {
		t.Errorf("first category = %q, want %q", result[0].categoryName, "Dining & Drinks")
	}
}

func TestSortByDescription(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, "", nil, nil, sortByDescription, true)
	if result[0].description != "DAN MURPHYS" {
		t.Errorf("first description = %q, want %q", result[0].description, "DAN MURPHYS")
	}
}

// ---------------------------------------------------------------------------
// Category filter tests
// ---------------------------------------------------------------------------

func TestCategoryFilterNil(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, "", nil, nil, sortByDate, false)
	if len(result) != 5 {
		t.Errorf("nil filter should return all rows, got %d", len(result))
	}
}

func TestCategoryFilterSingle(t *testing.T) {
	rows := testTransactions()
	filter := map[int]bool{2: true} // Groceries
	result := filteredRows(rows, "", filter, nil, sortByDate, false)
	if len(result) != 1 {
		t.Fatalf("expected 1 Groceries row, got %d", len(result))
	}
	if result[0].categoryName != "Groceries" {
		t.Errorf("expected Groceries, got %q", result[0].categoryName)
	}
}

func TestCategoryFilterMultiple(t *testing.T) {
	rows := testTransactions()
	filter := map[int]bool{2: true, 3: true} // Groceries + Dining
	result := filteredRows(rows, "", filter, nil, sortByDate, false)
	if len(result) != 2 {
		t.Errorf("expected 2 rows, got %d", len(result))
	}
}

func TestCategoryFilterUncategorised(t *testing.T) {
	rows := testTransactions()
	filter := map[int]bool{0: true} // sentinel for nil category
	result := filteredRows(rows, "", filter, nil, sortByDate, false)
	if len(result) != 2 {
		t.Errorf("expected 2 uncategorised rows, got %d", len(result))
	}
}

// ---------------------------------------------------------------------------
// Filter composition tests
// ---------------------------------------------------------------------------

func TestFilterComposition(t *testing.T) {
	rows := testTransactions()
	// Search for "payment" + uncategorised filter
	filter := map[int]bool{0: true}
	result := filteredRows(rows, "payment", filter, nil, sortByDate, false)
	if len(result) != 2 {
		t.Errorf("expected 2 rows matching 'payment' + uncategorised, got %d", len(result))
	}
}

// ---------------------------------------------------------------------------
// Sort column name tests
// ---------------------------------------------------------------------------

func TestSortColumnName(t *testing.T) {
	tests := []struct {
		col  int
		want string
	}{
		{sortByDate, "date"},
		{sortByAmount, "amount"},
		{sortByCategory, "category"},
		{sortByDescription, "description"},
		{99, "date"}, // unknown defaults to date
	}
	for _, tt := range tests {
		got := sortColumnName(tt.col)
		if got != tt.want {
			t.Errorf("sortColumnName(%d) = %q, want %q", tt.col, got, tt.want)
		}
	}
}

// ---------------------------------------------------------------------------
// Settings tests (Phase 4 — 2-column layout, enter/esc activate)
// ---------------------------------------------------------------------------

func testSettingsModel() model {
	m := newModel()
	m.activeTab = tabSettings
	m.ready = true
	m.categories = []category{
		{id: 1, name: "Income", color: "#a6e3a1", sortOrder: 1, isDefault: false},
		{id: 2, name: "Groceries", color: "#94e2d5", sortOrder: 2, isDefault: false},
		{id: 10, name: "Uncategorised", color: "#7f849c", sortOrder: 10, isDefault: true},
	}
	m.rules = []categoryRule{
		{id: 1, pattern: "WOOLWORTHS", categoryID: 2, priority: 0},
	}
	m.imports = []importRecord{
		{id: 1, filename: "test.csv", rowCount: 42, importedAt: "2026-02-06"},
	}
	m.dbInfo = dbInfo{schemaVersion: 2, transactionCount: 5, categoryCount: 3, ruleCount: 1, importCount: 1}
	return m
}

func TestSettingsColumnNavigation(t *testing.T) {
	m := testSettingsModel()
	// Starts on left column, Categories
	if m.settColumn != settColLeft {
		t.Fatalf("initial column = %d, want %d", m.settColumn, settColLeft)
	}
	if m.settSection != settSecCategories {
		t.Fatalf("initial section = %d, want %d", m.settSection, settSecCategories)
	}

	// l moves to right column (Chart)
	m2, _ := m.updateSettings(keyMsg("l"))
	m3 := m2.(model)
	if m3.settColumn != settColRight {
		t.Errorf("after l: column = %d, want %d", m3.settColumn, settColRight)
	}
	if m3.settSection != settSecChart {
		t.Errorf("after l: section = %d, want %d", m3.settSection, settSecChart)
	}

	// h moves back to left column
	m4, _ := m3.updateSettings(keyMsg("h"))
	m5 := m4.(model)
	if m5.settColumn != settColLeft {
		t.Errorf("after h: column = %d, want %d", m5.settColumn, settColLeft)
	}
	if m5.settSection != settSecCategories {
		t.Errorf("after h: section = %d, want %d", m5.settSection, settSecCategories)
	}
}

func TestSettingsRightColumnJK(t *testing.T) {
	m := testSettingsModel()
	m.settColumn = settColRight
	m.settSection = settSecChart

	m2, _ := m.updateSettings(keyMsg("j"))
	m3 := m2.(model)
	if m3.settSection != settSecDBImport {
		t.Errorf("after j: section = %d, want %d", m3.settSection, settSecDBImport)
	}

	m4, _ := m3.updateSettings(keyMsg("k"))
	m5 := m4.(model)
	if m5.settSection != settSecChart {
		t.Errorf("after k: section = %d, want %d", m5.settSection, settSecChart)
	}
}

func TestSettingsLeftColumnJK(t *testing.T) {
	m := testSettingsModel()
	// Left column: j toggles between Categories and Rules
	m2, _ := m.updateSettings(keyMsg("j"))
	m3 := m2.(model)
	if m3.settSection != settSecRules {
		t.Errorf("after j: section = %d, want %d", m3.settSection, settSecRules)
	}

	// j again wraps back to Categories
	m4, _ := m3.updateSettings(keyMsg("j"))
	m5 := m4.(model)
	if m5.settSection != settSecCategories {
		t.Errorf("after j j: section = %d, want %d", m5.settSection, settSecCategories)
	}

	// k from Categories wraps to Rules
	m6, _ := m5.updateSettings(keyMsg("k"))
	m7 := m6.(model)
	if m7.settSection != settSecRules {
		t.Errorf("after k: section = %d, want %d", m7.settSection, settSecRules)
	}
}

func TestSettingsActivateDeactivate(t *testing.T) {
	m := testSettingsModel()
	if m.settActive {
		t.Error("should start inactive")
	}

	// Enter activates
	m2, _ := m.updateSettings(keyMsg("enter"))
	m3 := m2.(model)
	if !m3.settActive {
		t.Error("should be active after enter")
	}

	// Esc deactivates
	m4, _ := m3.updateSettings(keyMsg("esc"))
	m5 := m4.(model)
	if m5.settActive {
		t.Error("should be inactive after esc")
	}
}

func TestSettingsCategoryItemNavigation(t *testing.T) {
	m := testSettingsModel()
	m.settActive = true
	m.settSection = settSecCategories
	m.settItemCursor = 0

	// j/k navigate items when active
	m2, _ := m.updateSettings(keyMsg("j"))
	m3 := m2.(model)
	if m3.settItemCursor != 1 {
		t.Errorf("after j: cursor = %d, want 1", m3.settItemCursor)
	}

	m4, _ := m3.updateSettings(keyMsg("k"))
	m5 := m4.(model)
	if m5.settItemCursor != 0 {
		t.Errorf("after k: cursor = %d, want 0", m5.settItemCursor)
	}
}

func TestSettingsCategoryAddMode(t *testing.T) {
	m := testSettingsModel()
	m.settActive = true
	m.settSection = settSecCategories

	// Enter add mode
	m2, _ := m.updateSettings(keyMsg("a"))
	m3 := m2.(model)
	if m3.settMode != settModeAddCat {
		t.Errorf("mode = %q, want %q", m3.settMode, settModeAddCat)
	}
	if m3.settInput != "" {
		t.Errorf("input should be empty, got %q", m3.settInput)
	}

	// Type name
	m4, _ := m3.updateSettings(keyMsg("T"))
	m5 := m4.(model)
	m6, _ := m5.updateSettings(keyMsg("e"))
	m7 := m6.(model)
	if m7.settInput != "Te" {
		t.Errorf("input = %q, want %q", m7.settInput, "Te")
	}

	// Escape cancels
	m8, _ := m7.updateSettings(keyMsg("esc"))
	m9 := m8.(model)
	if m9.settMode != settModeNone {
		t.Errorf("mode after esc = %q, want %q", m9.settMode, settModeNone)
	}
}

func TestSettingsCategoryEditMode(t *testing.T) {
	m := testSettingsModel()
	m.settActive = true
	m.settSection = settSecCategories
	m.settItemCursor = 0

	m2, _ := m.updateSettings(keyMsg("e"))
	m3 := m2.(model)
	if m3.settMode != settModeEditCat {
		t.Errorf("mode = %q, want %q", m3.settMode, settModeEditCat)
	}
	if m3.settInput != "Income" {
		t.Errorf("input = %q, want %q", m3.settInput, "Income")
	}
	if m3.settEditID != 1 {
		t.Errorf("editID = %d, want 1", m3.settEditID)
	}
}

func TestSettingsDeleteDefaultBlocked(t *testing.T) {
	m := testSettingsModel()
	m.settActive = true
	m.settSection = settSecCategories
	m.settItemCursor = 2 // Uncategorised (isDefault)

	m2, _ := m.updateSettings(keyMsg("d"))
	m3 := m2.(model)
	if m3.confirmAction != "" {
		t.Error("should not start confirm for default category")
	}
	if m3.status != "Cannot delete the default category." {
		t.Errorf("status = %q, want cannot-delete message", m3.status)
	}
}

func TestSettingsDeleteConfirmFlow(t *testing.T) {
	m := testSettingsModel()
	m.settActive = true
	m.settSection = settSecCategories
	m.settItemCursor = 0 // Income (not default)

	// First press arms confirm
	m2, _ := m.updateSettings(keyMsg("d"))
	m3 := m2.(model)
	if m3.confirmAction != "delete_cat" {
		t.Errorf("confirmAction = %q, want %q", m3.confirmAction, "delete_cat")
	}
	if m3.confirmID != 1 {
		t.Errorf("confirmID = %d, want 1", m3.confirmID)
	}

	// Any other key cancels
	m4, _ := m3.updateSettings(keyMsg("x"))
	m5 := m4.(model)
	if m5.confirmAction != "" {
		t.Errorf("confirmAction should be cleared after cancel, got %q", m5.confirmAction)
	}
}

func TestSettingsRuleItemNavigation(t *testing.T) {
	m := testSettingsModel()
	m.settSection = settSecRules
	m.settColumn = settColLeft
	m.settActive = true
	m.rules = append(m.rules, categoryRule{id: 2, pattern: "DAN", categoryID: 1})
	m.settItemCursor = 0

	m2, _ := m.updateSettings(keyMsg("j"))
	m3 := m2.(model)
	if m3.settItemCursor != 1 {
		t.Errorf("after j: cursor = %d, want 1", m3.settItemCursor)
	}
}

func TestSettingsRuleAddMode(t *testing.T) {
	m := testSettingsModel()
	m.settSection = settSecRules
	m.settActive = true

	m2, _ := m.updateSettings(keyMsg("a"))
	m3 := m2.(model)
	if m3.settMode != settModeAddRule {
		t.Errorf("mode = %q, want %q", m3.settMode, settModeAddRule)
	}
}

func TestSettingsRuleInputToCatPicker(t *testing.T) {
	m := testSettingsModel()
	m.settSection = settSecRules
	m.settActive = true
	m.settMode = settModeAddRule
	m.settInput = "COLES"

	// Enter transitions to category picker
	m2, _ := m.updateSettings(keyMsg("enter"))
	m3 := m2.(model)
	if m3.settMode != settModeRuleCat {
		t.Errorf("mode = %q, want %q", m3.settMode, settModeRuleCat)
	}
	if m3.settInput != "COLES" {
		t.Errorf("input should be preserved, got %q", m3.settInput)
	}
}

func TestSettingsDBClearConfirm(t *testing.T) {
	m := testSettingsModel()
	m.settSection = settSecDBImport
	m.settColumn = settColRight
	m.settActive = true

	m2, _ := m.updateSettings(keyMsg("c"))
	m3 := m2.(model)
	if m3.confirmAction != "clear_db" {
		t.Errorf("confirmAction = %q, want %q", m3.confirmAction, "clear_db")
	}
}

func TestSettingsChartToggleWeekBoundary(t *testing.T) {
	m := testSettingsModel()
	m.settSection = settSecChart
	m.settColumn = settColRight
	m.settActive = true
	m.spendingWeekAnchor = time.Sunday

	m2, _ := m.updateSettings(keyMsg("enter"))
	m3 := m2.(model)
	if m3.spendingWeekAnchor != time.Monday {
		t.Errorf("after enter: week anchor = %v, want Monday", m3.spendingWeekAnchor)
	}

	m4, _ := m3.updateSettings(keyMsg("l"))
	m5 := m4.(model)
	if m5.spendingWeekAnchor != time.Sunday {
		t.Errorf("after l: week anchor = %v, want Sunday", m5.spendingWeekAnchor)
	}
}

func TestSettingsConfirmExpired(t *testing.T) {
	m := testSettingsModel()
	m.confirmAction = "delete_cat"
	m.confirmID = 1

	// Simulate timer expiration
	m2, _ := m.Update(confirmExpiredMsg{})
	m3 := m2.(model)
	if m3.confirmAction != "" {
		t.Errorf("confirmAction should be cleared after expiry, got %q", m3.confirmAction)
	}
	if m3.confirmID != 0 {
		t.Errorf("confirmID should be 0 after expiry, got %d", m3.confirmID)
	}
}

func TestSettingsColorNavigation(t *testing.T) {
	m := testSettingsModel()
	m.settActive = true
	m.settSection = settSecCategories
	m.settMode = settModeAddCat
	m.settColorIdx = 0

	// Right moves color forward (l key)
	m2, _ := m.updateSettings(keyMsg("l"))
	m3 := m2.(model)
	if m3.settColorIdx != 1 {
		t.Errorf("after l: colorIdx = %d, want 1", m3.settColorIdx)
	}

	// Left wraps back
	m4, _ := m3.updateSettings(keyMsg("h"))
	m5 := m4.(model)
	if m5.settColorIdx != 0 {
		t.Errorf("after h: colorIdx = %d, want 0", m5.settColorIdx)
	}

	// Left from 0 wraps to last
	m6, _ := m5.updateSettings(keyMsg("h"))
	m7 := m6.(model)
	colors := CategoryAccentColors()
	if m7.settColorIdx != len(colors)-1 {
		t.Errorf("after h from 0: colorIdx = %d, want %d", m7.settColorIdx, len(colors)-1)
	}
}

func TestSettingsMaxVisibleRows(t *testing.T) {
	m := testSettingsModel()
	m.settSection = settSecDBImport
	m.settColumn = settColRight
	m.settActive = true

	initial := m.maxVisibleRows
	if initial < 5 || initial > 50 {
		t.Fatalf("initial maxVisibleRows = %d, want in [5,50]", initial)
	}

	// + increases
	m2, _ := m.updateSettings(keyMsg("+"))
	m3 := m2.(model)
	wantPlus := initial
	if initial < 50 {
		wantPlus = initial + 1
	}
	if m3.maxVisibleRows != wantPlus {
		t.Errorf("after +: maxVisibleRows = %d, want %d", m3.maxVisibleRows, wantPlus)
	}

	// - decreases
	m4, _ := m3.updateSettings(keyMsg("-"))
	m5 := m4.(model)
	if m5.maxVisibleRows != initial {
		t.Errorf("after -: maxVisibleRows = %d, want %d", m5.maxVisibleRows, initial)
	}

	// Clamp at min 5
	m6 := testSettingsModel()
	m6.settSection = settSecDBImport
	m6.settColumn = settColRight
	m6.settActive = true
	m6.maxVisibleRows = 5
	m7, _ := m6.updateSettings(keyMsg("-"))
	m8 := m7.(model)
	if m8.maxVisibleRows != 5 {
		t.Errorf("should not go below 5, got %d", m8.maxVisibleRows)
	}

	// Clamp at max 50
	m9 := testSettingsModel()
	m9.settSection = settSecDBImport
	m9.settColumn = settColRight
	m9.settActive = true
	m9.maxVisibleRows = 50
	m10, _ := m9.updateSettings(keyMsg("+"))
	m11 := m10.(model)
	if m11.maxVisibleRows != 50 {
		t.Errorf("should not go above 50, got %d", m11.maxVisibleRows)
	}
}

func TestSettingsVisibleRowsUsesMax(t *testing.T) {
	m := newModel()
	m.maxVisibleRows = 10
	m.height = 100 // plenty of space

	visible := m.visibleRows()
	if visible > 10 {
		t.Errorf("visibleRows() = %d, should be capped at maxVisibleRows=10", visible)
	}
}

// ---------------------------------------------------------------------------
// Tab cycling tests
// ---------------------------------------------------------------------------

func TestTabCycleForward(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabDashboard

	m2, _ := m.Update(tea.KeyMsg{Type: tea.KeyTab})
	m3 := m2.(model)
	if m3.activeTab != tabSettings {
		t.Errorf("after tab: activeTab = %d, want %d", m3.activeTab, tabSettings)
	}

	m4, _ := m3.Update(tea.KeyMsg{Type: tea.KeyTab})
	m5 := m4.(model)
	if m5.activeTab != tabManager {
		t.Errorf("after tab tab: activeTab = %d, want %d", m5.activeTab, tabManager)
	}

	// Wrap around
	m6, _ := m5.Update(tea.KeyMsg{Type: tea.KeyTab})
	m7 := m6.(model)
	if m7.activeTab != tabDashboard {
		t.Errorf("after tab tab tab: activeTab = %d, want %d (wrap)", m7.activeTab, tabDashboard)
	}
}

func TestTabCycleBackward(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabDashboard

	m2, _ := m.Update(tea.KeyMsg{Type: tea.KeyShiftTab})
	m3 := m2.(model)
	if m3.activeTab != tabManager {
		t.Errorf("after shift+tab from 0: activeTab = %d, want %d (wrap)", m3.activeTab, tabManager)
	}

	m4, _ := m3.Update(tea.KeyMsg{Type: tea.KeyShiftTab})
	m5 := m4.(model)
	if m5.activeTab != tabSettings {
		t.Errorf("after shift+tab: activeTab = %d, want %d", m5.activeTab, tabSettings)
	}
}

// ---------------------------------------------------------------------------
// Dupe modal key handling tests
// ---------------------------------------------------------------------------

func TestDupeModalCancel(t *testing.T) {
	m := newModel()
	m.ready = true
	m.importDupeModal = true
	m.importDupeFile = "test.csv"

	m2, _ := m.Update(keyMsg("c"))
	m3 := m2.(model)
	if m3.importDupeModal {
		t.Error("dupe modal should be closed after cancel")
	}
	if m3.status != "Import cancelled." {
		t.Errorf("status = %q, want cancelled message", m3.status)
	}
}

func TestFilePickerEsc(t *testing.T) {
	m := newModel()
	m.ready = true
	m.importPicking = true
	m.importFiles = []string{"a.csv", "b.csv"}

	m2, _ := m.Update(keyMsg("esc"))
	m3 := m2.(model)
	if m3.importPicking {
		t.Error("file picker should be closed after esc")
	}
}

func TestFilePickerNavigation(t *testing.T) {
	m := newModel()
	m.ready = true
	m.importPicking = true
	m.importFiles = []string{"a.csv", "b.csv", "c.csv"}
	m.importCursor = 0

	m2, _ := m.Update(keyMsg("j"))
	m3 := m2.(model)
	if m3.importCursor != 1 {
		t.Errorf("after j: importCursor = %d, want 1", m3.importCursor)
	}

	m4, _ := m3.Update(keyMsg("k"))
	m5 := m4.(model)
	if m5.importCursor != 0 {
		t.Errorf("after k: importCursor = %d, want 0", m5.importCursor)
	}
}

// keyMsg helper for tests
func keyMsg(k string) tea.KeyMsg {
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(k)}
}
