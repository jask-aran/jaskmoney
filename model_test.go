package main

import (
	"os"
	"path/filepath"
	"strings"
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

func mustParseFilter(t *testing.T, input string) *filterNode {
	t.Helper()
	node, err := parseFilter(input)
	if err != nil {
		t.Fatalf("parseFilter(%q): %v", input, err)
	}
	if !filterContainsFieldPredicate(node) {
		node = markTextNodesAsMetadata(node)
	}
	return node
}

// ---------------------------------------------------------------------------
// Filter tests
// ---------------------------------------------------------------------------

func TestFilteredRowsSearch(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, mustParseFilter(t, "woolworths"), nil, sortByDate, false)
	if len(result) != 1 {
		t.Fatalf("expected 1 result for 'woolworths', got %d", len(result))
	}
	if result[0].id != 3 {
		t.Errorf("expected transaction 3, got %d", result[0].id)
	}
}

func TestFilteredRowsPlainTextSearchesMetadataWhenNoPredicates(t *testing.T) {
	rows := testTransactions()
	txnTags := map[int][]tag{
		1: {{id: 1, name: "Afterwork"}},
	}

	byCategory := filteredRows(rows, mustParseFilter(t, "groc"), txnTags, sortByDate, false)
	if len(byCategory) != 1 || byCategory[0].id != 3 {
		t.Fatalf("expected metadata search to match category, got %+v", byCategory)
	}

	byTag := filteredRows(rows, mustParseFilter(t, "after"), txnTags, sortByDate, false)
	if len(byTag) != 1 || byTag[0].id != 1 {
		t.Fatalf("expected metadata search to match tags, got %+v", byTag)
	}
}

// ---------------------------------------------------------------------------
// Sort tests
// ---------------------------------------------------------------------------

func TestSortByDateAscending(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, nil, nil, sortByDate, true)
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
	result := filteredRows(rows, nil, nil, sortByDate, false)
	// Descending: newest first
	if result[0].dateISO != "2026-02-04" {
		t.Errorf("first row dateISO = %q, want %q", result[0].dateISO, "2026-02-04")
	}
}

func TestSortByAmount(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, nil, nil, sortByAmount, true)
	// Ascending: most negative first
	if result[0].amount != -55.30 {
		t.Errorf("first row amount = %.2f, want -55.30", result[0].amount)
	}
	if result[4].amount != 500.00 {
		t.Errorf("last row amount = %.2f, want 500.00", result[4].amount)
	}
}

func TestSortByAmountDescendingStableOnEqualValues(t *testing.T) {
	rows := []transaction{
		{id: 10, amount: 42.0, description: "A"},
		{id: 11, amount: 42.0, description: "B"},
		{id: 12, amount: 1.0, description: "C"},
	}
	sortTransactions(rows, sortByAmount, false)
	if rows[0].id != 10 || rows[1].id != 11 || rows[2].id != 12 {
		t.Fatalf("descending amount sort should preserve equal-value order, got ids [%d %d %d]", rows[0].id, rows[1].id, rows[2].id)
	}
}

func TestSortByCategory(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, nil, nil, sortByCategory, true)
	// Ascending alphabetical by category name
	if result[0].categoryName != "Dining & Drinks" {
		t.Errorf("first category = %q, want %q", result[0].categoryName, "Dining & Drinks")
	}
}

func TestSortByDescription(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, nil, nil, sortByDescription, true)
	if result[0].description != "DAN MURPHYS" {
		t.Errorf("first description = %q, want %q", result[0].description, "DAN MURPHYS")
	}
}

// ---------------------------------------------------------------------------
// Category filter tests
// ---------------------------------------------------------------------------

func TestCategoryFilterNil(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, nil, nil, sortByDate, false)
	if len(result) != 5 {
		t.Errorf("nil filter should return all rows, got %d", len(result))
	}
}

func TestCategoryFilterSingle(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, mustParseFilter(t, "cat:Groceries"), nil, sortByDate, false)
	if len(result) != 1 {
		t.Fatalf("expected 1 Groceries row, got %d", len(result))
	}
	if result[0].categoryName != "Groceries" {
		t.Errorf("expected Groceries, got %q", result[0].categoryName)
	}
}

func TestCategoryFilterMultiple(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, mustParseFilter(t, `cat:Groceries OR cat:"Dining & Drinks"`), nil, sortByDate, false)
	if len(result) != 2 {
		t.Errorf("expected 2 rows, got %d", len(result))
	}
}

func TestCategoryFilterUncategorised(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, mustParseFilter(t, "cat:Uncategorised"), nil, sortByDate, false)
	if len(result) != 2 {
		t.Errorf("expected 2 uncategorised rows, got %d", len(result))
	}
}

// ---------------------------------------------------------------------------
// Filter composition tests
// ---------------------------------------------------------------------------

func TestFilterComposition(t *testing.T) {
	rows := testTransactions()
	result := filteredRows(rows, mustParseFilter(t, "payment cat:Uncategorised"), nil, sortByDate, false)
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

func TestDashboardSpendRowsExcludesIgnoreTag(t *testing.T) {
	rows := []transaction{
		{id: 1, amount: -10, description: "A"},
		{id: 2, amount: -20, description: "B"},
	}
	txnTags := map[int][]tag{
		2: {{id: 1, name: "IGNORE"}},
	}
	out := dashboardSpendRows(rows, txnTags)
	if len(out) != 1 || out[0].id != 1 {
		t.Fatalf("dashboardSpendRows = %+v, want only txn id 1", out)
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

	m4, _ := m3.updateSettings(keyMsg("j"))
	m5 := m4.(model)
	if m5.settSection != settSecImportHistory {
		t.Errorf("after j j: section = %d, want %d", m5.settSection, settSecImportHistory)
	}

	m6, _ := m5.updateSettings(keyMsg("k"))
	m7 := m6.(model)
	if m7.settSection != settSecDBImport {
		t.Errorf("after k: section = %d, want %d", m7.settSection, settSecDBImport)
	}
}

func TestSettingsLeftColumnJK(t *testing.T) {
	m := testSettingsModel()
	// Left column: Categories -> Tags -> Rules -> Categories
	m2, _ := m.updateSettings(keyMsg("j"))
	m3 := m2.(model)
	if m3.settSection != settSecTags {
		t.Errorf("after j: section = %d, want %d", m3.settSection, settSecTags)
	}

	// j again moves to Rules
	m4, _ := m3.updateSettings(keyMsg("j"))
	m5 := m4.(model)
	if m5.settSection != settSecRules {
		t.Errorf("after j j: section = %d, want %d", m5.settSection, settSecRules)
	}

	// k from Rules goes back to Tags
	m6, _ := m5.updateSettings(keyMsg("k"))
	m7 := m6.(model)
	if m7.settSection != settSecTags {
		t.Errorf("after k: section = %d, want %d", m7.settSection, settSecTags)
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

	// up/down navigate items when active
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

	m2, _ := m.updateSettings(keyMsg("enter"))
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

func TestSettingsTagEditModeWithEnter(t *testing.T) {
	m := testSettingsModel()
	m.tags = []tag{{id: 1, name: "IGNORE", color: "#f38ba8"}}
	m.settActive = true
	m.settSection = settSecTags
	m.settItemCursor = 0

	m2, _ := m.updateSettings(keyMsg("enter"))
	m3 := m2.(model)
	if m3.settMode != settModeEditTag {
		t.Errorf("mode = %q, want %q", m3.settMode, settModeEditTag)
	}
	if m3.settInput != "IGNORE" {
		t.Errorf("input = %q, want %q", m3.settInput, "IGNORE")
	}
}

func TestSettingsDeleteDefaultBlocked(t *testing.T) {
	m := testSettingsModel()
	m.settActive = true
	m.settSection = settSecCategories
	m.settItemCursor = 2 // Uncategorised (isDefault)

	delKey := m.primaryActionKey(scopeSettingsActiveCategories, actionDelete, "del")
	m2, _ := m.updateSettings(bindingKeyMsg(delKey))
	m3 := m2.(model)
	if m3.confirmAction != confirmActionNone {
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
	delKey := m.primaryActionKey(scopeSettingsActiveCategories, actionDelete, "del")
	m2, _ := m.updateSettings(bindingKeyMsg(delKey))
	m3 := m2.(model)
	if m3.confirmAction != confirmActionDeleteCategory {
		t.Errorf("confirmAction = %q, want %q", m3.confirmAction, confirmActionDeleteCategory)
	}
	if m3.confirmID != 1 {
		t.Errorf("confirmID = %d, want 1", m3.confirmID)
	}

	// Any other key cancels
	m4, _ := m3.updateSettings(keyMsg("x"))
	m5 := m4.(model)
	if m5.confirmAction != confirmActionNone {
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
	if m3.confirmAction != confirmActionClearDB {
		t.Errorf("confirmAction = %q, want %q", m3.confirmAction, confirmActionClearDB)
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
	m.confirmAction = confirmActionDeleteCategory
	m.confirmID = 1

	// Simulate timer expiration
	m2, _ := m.Update(confirmExpiredMsg{})
	m3 := m2.(model)
	if m3.confirmAction != confirmActionNone {
		t.Errorf("confirmAction should be cleared after expiry, got %q", m3.confirmAction)
	}
	if m3.confirmID != 0 {
		t.Errorf("confirmID should be 0 after expiry, got %d", m3.confirmID)
	}
}

func TestSettingsConfirmCancelAnyOtherKey(t *testing.T) {
	tests := []struct {
		name   string
		action settingsConfirmAction
	}{
		{name: "delete category", action: confirmActionDeleteCategory},
		{name: "delete tag", action: confirmActionDeleteTag},
		{name: "delete rule", action: confirmActionDeleteRule},
		{name: "clear db", action: confirmActionClearDB},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := testSettingsModel()
			m.confirmAction = tt.action
			m.confirmID = 123

			next, _ := m.updateSettings(keyMsg("x"))
			got := next.(model)
			if got.confirmAction != confirmActionNone {
				t.Fatalf("confirmAction = %q, want cleared", got.confirmAction)
			}
			if got.confirmID != 0 {
				t.Fatalf("confirmID = %d, want 0", got.confirmID)
			}
			if got.status != "Cancelled." {
				t.Fatalf("status = %q, want %q", got.status, "Cancelled.")
			}
		})
	}
}

func TestSettingsConfirmExecuteCommandTypes(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	tests := []struct {
		name      string
		action    settingsConfirmAction
		confirm   tea.KeyMsg
		confirmID int
		wantType  string
	}{
		{name: "delete category", action: confirmActionDeleteCategory, confirm: tea.KeyMsg{}, confirmID: 1, wantType: "categoryDeletedMsg"},
		{name: "delete tag", action: confirmActionDeleteTag, confirm: tea.KeyMsg{}, confirmID: 1, wantType: "tagDeletedMsg"},
		{name: "delete rule", action: confirmActionDeleteRule, confirm: tea.KeyMsg{}, confirmID: 1, wantType: "ruleDeletedMsg"},
		{name: "clear db", action: confirmActionClearDB, confirm: keyMsg("c"), confirmID: 0, wantType: "clearDoneMsg"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			m := testSettingsModel()
			m.db = db
			m.confirmAction = tt.action
			m.confirmID = tt.confirmID
			if tt.action != confirmActionClearDB {
				scope := scopeSettingsActiveCategories
				switch tt.action {
				case confirmActionDeleteTag:
					scope = scopeSettingsActiveTags
				case confirmActionDeleteRule:
					scope = scopeSettingsActiveRules
				}
				delKey := m.primaryActionKey(scope, actionDelete, "del")
				tt.confirm = bindingKeyMsg(delKey)
			}

			next, cmd := m.updateSettings(tt.confirm)
			got := next.(model)
			if got.confirmAction != confirmActionNone {
				t.Fatalf("confirmAction = %q, want cleared", got.confirmAction)
			}
			if cmd == nil {
				t.Fatal("expected non-nil command for confirm action")
			}
			msg := cmd()
			switch tt.wantType {
			case "categoryDeletedMsg":
				if _, ok := msg.(categoryDeletedMsg); !ok {
					t.Fatalf("msg type = %T, want categoryDeletedMsg", msg)
				}
			case "tagDeletedMsg":
				if _, ok := msg.(tagDeletedMsg); !ok {
					t.Fatalf("msg type = %T, want tagDeletedMsg", msg)
				}
			case "ruleDeletedMsg":
				if _, ok := msg.(ruleDeletedMsg); !ok {
					t.Fatalf("msg type = %T, want ruleDeletedMsg", msg)
				}
			case "clearDoneMsg":
				if _, ok := msg.(clearDoneMsg); !ok {
					t.Fatalf("msg type = %T, want clearDoneMsg", msg)
				}
			default:
				t.Fatalf("unknown expected type %q", tt.wantType)
			}
		})
	}
}

func TestSettingsColorNavigation(t *testing.T) {
	m := testSettingsModel()
	m.settActive = true
	m.settSection = settSecCategories
	m.settMode = settModeAddCat
	m.settColorIdx = 0

	// Move focus to color field.
	m1, _ := m.updateSettings(tea.KeyMsg{Type: tea.KeyDown})
	m = m1.(model)

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

func TestSettingsImportEntryParity(t *testing.T) {
	assertImportEntry := func(t *testing.T, m model, key tea.KeyMsg) {
		t.Helper()
		m.importPicking = false
		m.importFiles = []string{"stale.csv"}
		m.importCursor = 2

		next, cmd := m.updateSettings(key)
		got := next.(model)
		if !got.importPicking {
			t.Fatal("import picker should be open")
		}
		if got.importFiles != nil {
			t.Fatalf("import files should be reset, got %v", got.importFiles)
		}
		if got.importCursor != 0 {
			t.Fatalf("import cursor = %d, want 0", got.importCursor)
		}
		if cmd == nil {
			t.Fatal("expected loadFiles command")
		}
	}

	// Settings nav mode import shortcut
	m := testSettingsModel()
	assertImportEntry(t, m, keyMsg("i"))

	// Active DB & Import section import shortcut
	m2 := testSettingsModel()
	m2.settSection = settSecDBImport
	m2.settColumn = settColRight
	m2.settActive = true
	assertImportEntry(t, m2, keyMsg("i"))
}

func TestSettingsResetKeybindingsRewritesDefaultFile(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	m := testSettingsModel()
	m.settSection = settSecDBImport
	m.settColumn = settColRight
	m.settActive = true

	path, err := keybindingsPath()
	if err != nil {
		t.Fatalf("keybindingsPath: %v", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir keybindings dir: %v", err)
	}
	if err := os.WriteFile(path, []byte("version = 2\n\n[bindings]\nquick_tag = [\"ctrl+t\"]\n"), 0o644); err != nil {
		t.Fatalf("seed keybindings file: %v", err)
	}

	resetKey := m.primaryActionKey(scopeSettingsActiveDBImport, actionResetKeybindings, "R")
	next, cmd := m.updateSettings(keyMsg(resetKey))
	got := next.(model)
	if cmd == nil {
		t.Fatal("expected reset keybindings command")
	}
	msg := cmd()
	if _, ok := msg.(keybindingsResetMsg); !ok {
		t.Fatalf("reset command message = %T, want keybindingsResetMsg", msg)
	}
	next, _ = got.Update(msg)
	got2 := next.(model)
	if got2.statusErr {
		t.Fatalf("expected reset success status, got error: %q", got2.status)
	}
	if got2.status != "Keybindings reset to defaults." {
		t.Fatalf("status = %q, want reset success", got2.status)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read rewritten keybindings: %v", err)
	}
	out := string(data)
	if !strings.Contains(out, "[bindings]") {
		t.Fatalf("missing bindings table in rewritten keybindings:\n%s", out)
	}
	if !strings.Contains(out, "up") || !strings.Contains(out, "down") {
		t.Fatalf("rewritten keybindings missing directional actions:\n%s", out)
	}
}

func TestSettingsRowsPerPageCustomDirectionalOverride(t *testing.T) {
	reg := NewKeyRegistry()
	if err := reg.ApplyOverrides([]shortcutOverride{
		{Scope: scopeSettingsActiveDBImport, Action: string(actionRowsPerPage), Keys: []string{"ctrl+j", "ctrl+k"}},
	}); err != nil {
		t.Fatalf("apply overrides: %v", err)
	}

	m := testSettingsModel()
	m.keys = reg
	m.settSection = settSecDBImport
	m.settColumn = settColRight
	m.settActive = true
	m.maxVisibleRows = 20

	next, _ := m.updateSettings(tea.KeyMsg{Type: tea.KeyCtrlJ})
	got := next.(model)
	if got.maxVisibleRows != 21 {
		t.Fatalf("after ctrl+j: maxVisibleRows = %d, want 21", got.maxVisibleRows)
	}

	next2, _ := got.updateSettings(tea.KeyMsg{Type: tea.KeyCtrlK})
	got2 := next2.(model)
	if got2.maxVisibleRows != 20 {
		t.Fatalf("after ctrl+k: maxVisibleRows = %d, want 20", got2.maxVisibleRows)
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

func TestTabNumberShortcuts(t *testing.T) {
	m := newModel()
	m.ready = true
	m.managerMode = managerModeAccounts
	tests := []struct {
		action Action
		want   int
	}{
		{actionCommandGoTransactions, tabManager},
		{actionCommandGoDashboard, tabDashboard},
		{actionCommandGoSettings, tabSettings},
	}
	for _, tt := range tests {
		key := m.primaryActionKey(scopeGlobal, tt.action, "")
		if key == "" {
			t.Fatalf("missing key for global action %q", tt.action)
		}
		next, _ := m.Update(keyMsg(key))
		got := next.(model)
		if got.activeTab != tt.want {
			t.Fatalf("after action %q key %q: activeTab = %d, want %d", tt.action, key, got.activeTab, tt.want)
		}
		if tt.want == tabManager && got.managerMode != managerModeTransactions {
			t.Fatalf("after action %q key %q: managerMode = %d, want transactions", tt.action, key, got.managerMode)
		}
		m = got
	}
}

func TestTabNumberShortcutsWorkInSettingsMenu(t *testing.T) {
	m := testSettingsModel()
	m.ready = true
	m.activeTab = tabSettings
	m.settActive = true
	m.settSection = settSecDBImport

	toManager := m.primaryActionKey(scopeGlobal, actionCommandGoTransactions, "1")
	toDash := m.primaryActionKey(scopeGlobal, actionCommandGoDashboard, "2")
	toSettings := m.primaryActionKey(scopeGlobal, actionCommandGoSettings, "3")

	next, _ := m.Update(keyMsg(toManager))
	got := next.(model)
	if got.activeTab != tabManager {
		t.Fatalf("after manager shortcut in settings: activeTab = %d, want %d", got.activeTab, tabManager)
	}
	if got.managerMode != managerModeTransactions {
		t.Fatalf("after manager shortcut in settings: managerMode = %d, want managerModeTransactions", got.managerMode)
	}

	next, _ = got.Update(keyMsg(toDash))
	got = next.(model)
	if got.activeTab != tabDashboard {
		t.Fatalf("after dashboard shortcut in settings flow: activeTab = %d, want %d", got.activeTab, tabDashboard)
	}

	got.activeTab = tabSettings
	next, _ = got.Update(keyMsg(toSettings))
	got = next.(model)
	if got.activeTab != tabSettings {
		t.Fatalf("after settings shortcut in settings flow: activeTab = %d, want %d", got.activeTab, tabSettings)
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

	closeKey := m.primaryActionKey(scopeDupeModal, actionClose, "esc")
	m2, _ := m.Update(keyMsg(closeKey))
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

func TestSettingsAddScopedTagSavesCategoryScope(t *testing.T) {
	m := testSettingsModel()
	db, cleanup := testDB(t)
	defer cleanup()

	m.db = db
	m.settActive = true
	m.settSection = settSecTags

	addKey := m.primaryActionKey(scopeSettingsActiveTags, actionAdd, "a")
	next, _ := m.updateSettings(keyMsg(addKey))
	got := next.(model)
	if got.settMode != settModeAddTag {
		t.Fatalf("mode = %q, want %q", got.settMode, settModeAddTag)
	}
	if got.settTagScopeID != 0 {
		t.Fatalf("default tag scope = %d, want global (0)", got.settTagScopeID)
	}

	for _, ch := range []string{"S", "c", "o", "p", "e", "d"} {
		next, _ = got.updateSettings(keyMsg(ch))
		got = next.(model)
	}
	next, _ = got.updateSettings(tea.KeyMsg{Type: tea.KeyDown})
	got = next.(model)
	next, _ = got.updateSettings(tea.KeyMsg{Type: tea.KeyDown})
	got = next.(model)
	next, _ = got.updateSettings(tea.KeyMsg{Type: tea.KeyRight})
	got = next.(model)
	if got.settTagScopeID == 0 {
		t.Fatal("expected non-global scope after h/l adjust on scope field")
	}

	saveKey := got.primaryActionKey(scopeSettingsModeTag, actionSave, "enter")
	next, cmd := got.updateSettings(keyMsg(saveKey))
	got = next.(model)
	if cmd == nil {
		t.Fatal("expected save command")
	}
	msg := cmd()
	saved, ok := msg.(tagSavedMsg)
	if !ok {
		t.Fatalf("save message type = %T, want tagSavedMsg", msg)
	}
	if saved.err != nil {
		t.Fatalf("tag save error: %v", saved.err)
	}

	stored, err := loadTagByNameCI(db, "Scoped")
	if err != nil {
		t.Fatalf("loadTagByNameCI: %v", err)
	}
	if stored == nil {
		t.Fatal("expected stored tag")
	}
	if stored.categoryID == nil {
		t.Fatal("stored tag should keep selected category scope")
	}
	if *stored.categoryID != got.settTagScopeID {
		t.Fatalf("stored category scope = %d, want %d", *stored.categoryID, got.settTagScopeID)
	}
}

func TestSettingsTagNameFieldIgnoresColorScopeAdjustKeys(t *testing.T) {
	m := testSettingsModel()
	m.settActive = true
	m.settSection = settSecTags
	addKey := m.primaryActionKey(scopeSettingsActiveTags, actionAdd, "a")
	next, _ := m.updateSettings(keyMsg(addKey))
	got := next.(model)
	if got.settMode != settModeAddTag {
		t.Fatalf("mode = %q, want %q", got.settMode, settModeAddTag)
	}
	if got.settTagFocus != 0 {
		t.Fatalf("tag focus = %d, want name field (0)", got.settTagFocus)
	}

	initialColor := got.settColorIdx
	initialScope := got.settTagScopeID

	scopeAdjustKey := "l"
	for _, b := range got.keys.BindingsForScope(scopeSettingsModeTag) {
		if b.Action != actionRight {
			continue
		}
		for _, k := range b.Keys {
			if navDeltaFromKeyName(normalizeKeyName(k)) > 0 {
				scopeAdjustKey = k
				break
			}
		}
	}

	next, _ = got.updateSettings(keyMsg(scopeAdjustKey))
	got = next.(model)
	if got.settColorIdx != initialColor {
		t.Fatalf("color index changed on name field: got %d want %d", got.settColorIdx, initialColor)
	}
	if got.settTagScopeID != initialScope {
		t.Fatalf("scope changed on name field: got %d want %d", got.settTagScopeID, initialScope)
	}
}

func TestSettingsCategoryNameFieldConsumesShortcutKeys(t *testing.T) {
	m := testSettingsModel()
	m.ready = true
	m.activeTab = tabSettings
	m.settActive = true
	m.settSection = settSecCategories

	addKey := m.primaryActionKey(scopeSettingsActiveCategories, actionAdd, "a")
	next, _ := m.updateSettings(keyMsg(addKey))
	got := next.(model)
	if got.settMode != settModeAddCat {
		t.Fatalf("mode = %q, want %q", got.settMode, settModeAddCat)
	}
	if got.settCatFocus != 0 {
		t.Fatalf("category focus = %d, want 0", got.settCatFocus)
	}

	var cmd tea.Cmd
	for _, key := range []string{"q", "h", "j", "k", "l", "s"} {
		next, cmd = got.updateSettings(keyMsg(key))
		if cmd != nil {
			t.Fatalf("key %q should not trigger command while editing category name", key)
		}
		got = next.(model)
	}

	if got.settInput != "qhjkls" {
		t.Fatalf("category input = %q, want %q", got.settInput, "qhjkls")
	}
	if got.settMode != settModeAddCat {
		t.Fatalf("mode = %q, want %q", got.settMode, settModeAddCat)
	}
	if got.settCatFocus != 0 {
		t.Fatalf("category focus changed = %d, want 0", got.settCatFocus)
	}
	if got.activeTab != tabSettings {
		t.Fatalf("activeTab = %d, want %d", got.activeTab, tabSettings)
	}
}

func TestSettingsTagNameFieldConsumesShortcutKeys(t *testing.T) {
	m := testSettingsModel()
	m.ready = true
	m.activeTab = tabSettings
	m.settActive = true
	m.settSection = settSecTags

	addKey := m.primaryActionKey(scopeSettingsActiveTags, actionAdd, "a")
	next, _ := m.updateSettings(keyMsg(addKey))
	got := next.(model)
	if got.settMode != settModeAddTag {
		t.Fatalf("mode = %q, want %q", got.settMode, settModeAddTag)
	}
	if got.settTagFocus != 0 {
		t.Fatalf("tag focus = %d, want 0", got.settTagFocus)
	}

	var cmd tea.Cmd
	for _, key := range []string{"q", "h", "j", "k", "l", "s"} {
		next, cmd = got.updateSettings(keyMsg(key))
		if cmd != nil {
			t.Fatalf("key %q should not trigger command while editing tag name", key)
		}
		got = next.(model)
	}

	if got.settInput != "qhjkls" {
		t.Fatalf("tag input = %q, want %q", got.settInput, "qhjkls")
	}
	if got.settMode != settModeAddTag {
		t.Fatalf("mode = %q, want %q", got.settMode, settModeAddTag)
	}
	if got.settTagFocus != 0 {
		t.Fatalf("tag focus changed = %d, want 0", got.settTagFocus)
	}
	if got.activeTab != tabSettings {
		t.Fatalf("activeTab = %d, want %d", got.activeTab, tabSettings)
	}
}

func TestSettingsCategoryNameFieldArrowCursorEditsInMiddle(t *testing.T) {
	m := testSettingsModel()
	m.settActive = true
	m.settSection = settSecCategories
	addKey := m.primaryActionKey(scopeSettingsActiveCategories, actionAdd, "a")
	next, _ := m.updateSettings(keyMsg(addKey))
	got := next.(model)

	for _, ch := range []string{"A", "B", "C"} {
		next, _ = got.updateSettings(keyMsg(ch))
		got = next.(model)
	}
	if got.settInput != "ABC" || got.settInputCursor != 3 {
		t.Fatalf("initial input/cursor = %q/%d, want ABC/3", got.settInput, got.settInputCursor)
	}

	next, _ = got.updateSettings(tea.KeyMsg{Type: tea.KeyLeft})
	got = next.(model)
	next, _ = got.updateSettings(tea.KeyMsg{Type: tea.KeyLeft})
	got = next.(model)
	if got.settInputCursor != 1 {
		t.Fatalf("cursor after left,left = %d, want 1", got.settInputCursor)
	}

	next, _ = got.updateSettings(keyMsg("X"))
	got = next.(model)
	if got.settInput != "AXBC" {
		t.Fatalf("input after middle insert = %q, want %q", got.settInput, "AXBC")
	}
	if got.settInputCursor != 2 {
		t.Fatalf("cursor after insert = %d, want 2", got.settInputCursor)
	}

	next, _ = got.updateSettings(tea.KeyMsg{Type: tea.KeyBackspace})
	got = next.(model)
	if got.settInput != "ABC" {
		t.Fatalf("input after backspace = %q, want %q", got.settInput, "ABC")
	}
	if got.settInputCursor != 1 {
		t.Fatalf("cursor after backspace = %d, want 1", got.settInputCursor)
	}
}

func TestSettingsTagNameFieldArrowCursorEditsInMiddle(t *testing.T) {
	m := testSettingsModel()
	m.settActive = true
	m.settSection = settSecTags
	addKey := m.primaryActionKey(scopeSettingsActiveTags, actionAdd, "a")
	next, _ := m.updateSettings(keyMsg(addKey))
	got := next.(model)

	for _, ch := range []string{"T", "A", "G"} {
		next, _ = got.updateSettings(keyMsg(ch))
		got = next.(model)
	}
	if got.settInput != "TAG" || got.settInputCursor != 3 {
		t.Fatalf("initial input/cursor = %q/%d, want TAG/3", got.settInput, got.settInputCursor)
	}

	next, _ = got.updateSettings(tea.KeyMsg{Type: tea.KeyLeft})
	got = next.(model)
	if got.settInputCursor != 2 {
		t.Fatalf("cursor after left = %d, want 2", got.settInputCursor)
	}

	next, _ = got.updateSettings(keyMsg("X"))
	got = next.(model)
	if got.settInput != "TAXG" {
		t.Fatalf("input after middle insert = %q, want %q", got.settInput, "TAXG")
	}
	if got.settInputCursor != 3 {
		t.Fatalf("cursor after insert = %d, want 3", got.settInputCursor)
	}
}

// keyMsg helper for tests
func keyMsg(k string) tea.KeyMsg {
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(k)}
}

func bindingKeyMsg(k string) tea.KeyMsg {
	switch normalizeKeyName(k) {
	case "del":
		return tea.KeyMsg{Type: tea.KeyDelete}
	default:
		return keyMsg(k)
	}
}

func assertScrollableWindowInvariant(
	t *testing.T,
	m model,
	steps int,
	moveDown func(model) model,
	visibleFn func(model) int,
) {
	t.Helper()
	wantMaxRows := m.maxVisibleRows
	wantVisible := visibleFn(m)
	if wantVisible < 1 {
		t.Fatalf("invalid visible rows: %d", wantVisible)
	}
	for i := 0; i < steps; i++ {
		m = moveDown(m)
		if m.maxVisibleRows != wantMaxRows {
			t.Fatalf("maxVisibleRows mutated at step %d: got %d want %d", i, m.maxVisibleRows, wantMaxRows)
		}
		if gotVisible := visibleFn(m); gotVisible != wantVisible {
			t.Fatalf("visible rows changed at step %d: got %d want %d", i, gotVisible, wantVisible)
		}
		if m.cursor >= m.topIndex+wantVisible {
			t.Fatalf("cursor escaped window at step %d: cursor=%d topIndex=%d visible=%d", i, m.cursor, m.topIndex, wantVisible)
		}
	}
}

func TestTransactionsTableDownNavigationViewportStable(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabManager
	m.managerMode = managerModeTransactions
	m.height = 28
	m.width = 120
	m.maxVisibleRows = 20
	rows := make([]transaction, 0, 80)
	for i := 0; i < 80; i++ {
		rows = append(rows, transaction{
			id:           i + 1,
			dateISO:      "2026-02-10",
			amount:       float64(-i - 1),
			description:  "TXN",
			categoryName: "Uncategorised",
		})
	}
	m.rows = rows

	assertScrollableWindowInvariant(
		t,
		m,
		40,
		func(in model) model {
			next, _ := in.updateNavigation(keyMsg("down"))
			return next.(model)
		},
		func(in model) int { return in.visibleRows() },
	)
}

func TestManagerTransactionsDownNavigationDoesNotShrinkVisibleRows(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabManager
	m.managerMode = managerModeTransactions
	m.height = 28
	m.width = 120
	m.maxVisibleRows = 20

	// Build enough rows to force scrolling.
	rows := make([]transaction, 0, 80)
	for i := 0; i < 80; i++ {
		rows = append(rows, transaction{
			id:           i + 1,
			dateISO:      "2026-02-10",
			amount:       float64(-i - 1),
			description:  "TXN",
			categoryName: "Uncategorised",
		})
	}
	m.rows = rows
	assertScrollableWindowInvariant(
		t,
		m,
		40,
		func(in model) model {
			next, _ := in.updateManager(keyMsg("down"))
			return next.(model)
		},
		func(in model) int { return in.managerVisibleRows() },
	)
}

func TestFilePickerCursorClampsWithRepeatedNavigation(t *testing.T) {
	m := newModel()
	m.ready = true
	m.importPicking = true
	m.importFiles = []string{"a.csv", "b.csv", "c.csv"}
	m.importCursor = 0

	for i := 0; i < 20; i++ {
		next, _ := m.updateFilePicker(keyMsg("down"))
		m = next.(model)
	}
	if m.importCursor != len(m.importFiles)-1 {
		t.Fatalf("importCursor after repeated down = %d, want %d", m.importCursor, len(m.importFiles)-1)
	}
	for i := 0; i < 20; i++ {
		next, _ := m.updateFilePicker(keyMsg("up"))
		m = next.(model)
	}
	if m.importCursor != 0 {
		t.Fatalf("importCursor after repeated up = %d, want 0", m.importCursor)
	}
}
