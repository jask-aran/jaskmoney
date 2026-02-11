package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

// Tier 3: Cross-mode user flow regression tests.

func flowKey(k string) tea.KeyMsg {
	return tea.KeyMsg{Type: tea.KeyRunes, Runes: []rune(k)}
}

func flowApplyMsg(t *testing.T, m model, msg tea.Msg) model {
	t.Helper()
	next, cmd := m.Update(msg)
	got, ok := next.(model)
	if !ok {
		t.Fatalf("Update returned %T, want model", next)
	}
	return flowDrainCmd(t, got, cmd)
}

func flowPress(t *testing.T, m model, key string) model {
	t.Helper()
	return flowApplyMsg(t, m, flowKey(key))
}

func flowType(t *testing.T, m model, input string) model {
	t.Helper()
	for _, r := range input {
		m = flowPress(t, m, string(r))
	}
	return m
}

func flowDrainCmd(t *testing.T, m model, cmd tea.Cmd) model {
	t.Helper()
	for i := 0; cmd != nil && i < 32; i++ {
		msg := cmd()
		if msg == nil {
			return m
		}
		next, nextCmd := m.Update(msg)
		got, ok := next.(model)
		if !ok {
			t.Fatalf("command update returned %T, want model", next)
		}
		m = got
		cmd = nextCmd
	}
	if cmd != nil {
		t.Fatal("command chain exceeded max depth")
	}
	return m
}

func flowRefresh(t *testing.T, m model) model {
	t.Helper()
	if m.db == nil {
		t.Fatal("flowRefresh requires non-nil db")
	}
	return flowDrainCmd(t, m, refreshCmd(m.db))
}

func newFlowModelWithDB(t *testing.T) (model, func()) {
	t.Helper()
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	db, cleanupDB := testDB(t)
	m := newModel()
	m.db = db
	m.ready = true
	m.width = 120
	m.height = 40
	m.formats = defaultFormats()
	if err := syncAccountsFromFormats(db, m.formats); err != nil {
		cleanupDB()
		t.Fatalf("syncAccountsFromFormats: %v", err)
	}
	m = flowRefresh(t, m)
	cleanup := func() {
		cleanupDB()
	}
	return m, cleanup
}

func writeFlowCSV(t *testing.T, dir, filename, content string) {
	t.Helper()
	path := filepath.Join(dir, filename)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write csv %q: %v", path, err)
	}
}

func loadTxnByID(t *testing.T, db *sql.DB, id int) transaction {
	t.Helper()
	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	for _, row := range rows {
		if row.id == id {
			return row
		}
	}
	t.Fatalf("transaction id %d not found", id)
	return transaction{}
}

func hasTagNamed(tags []tag, name string) bool {
	for _, tg := range tags {
		if strings.EqualFold(tg.name, name) {
			return true
		}
	}
	return false
}

func TestFlowSettingsImportWithDupesSkipPersistsAndRecordsImport(t *testing.T) {
	m, cleanup := newFlowModelWithDB(t)
	defer cleanup()

	base := t.TempDir()
	m.basePath = base
	m.activeTab = tabSettings
	writeFlowCSV(t, base, "ANZ-flow.csv", "3/02/2026,-20.00,DAN MURPHYS\n4/02/2026,203.92,PAYMENT RECEIVED\n")

	m = flowPress(t, m, "i")
	if !m.importPicking {
		t.Fatal("expected file picker open after settings import shortcut")
	}
	if len(m.importFiles) != 1 || m.importFiles[0] != "ANZ-flow.csv" {
		t.Fatalf("importFiles = %v, want [ANZ-flow.csv]", m.importFiles)
	}

	m = flowPress(t, m, "enter")
	if m.statusErr {
		t.Fatalf("import status error: %q", m.status)
	}
	rows, err := loadRows(m.db)
	if err != nil {
		t.Fatalf("loadRows after first import: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows after first import = %d, want 2", len(rows))
	}
	imports, err := loadImports(m.db)
	if err != nil {
		t.Fatalf("loadImports after first import: %v", err)
	}
	if len(imports) != 1 {
		t.Fatalf("imports after first import = %d, want 1", len(imports))
	}

	m = flowPress(t, m, "i")
	m = flowPress(t, m, "enter")
	if !m.importDupeModal {
		t.Fatal("expected duplicate modal on second import")
	}
	if m.importDupeCount != 2 || m.importDupeTotal != 2 {
		t.Fatalf("dupe counts = %d/%d, want 2/2", m.importDupeCount, m.importDupeTotal)
	}

	m = flowPress(t, m, "s")
	if m.statusErr {
		t.Fatalf("skip-dupes status error: %q", m.status)
	}
	rows, err = loadRows(m.db)
	if err != nil {
		t.Fatalf("loadRows after skip-dupes import: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows after skip-dupes import = %d, want 2", len(rows))
	}
	imports, err = loadImports(m.db)
	if err != nil {
		t.Fatalf("loadImports after skip-dupes import: %v", err)
	}
	if len(imports) != 2 {
		t.Fatalf("imports after skip-dupes import = %d, want 2", len(imports))
	}
}

func TestFlowManagerQuickCategoryAndTagPersistAfterRefresh(t *testing.T) {
	m, cleanup := newFlowModelWithDB(t)
	defer cleanup()

	_, err := m.db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES
			('03/02/2026', '2026-02-03', -10.00, 'FLOW A', ''),
			('03/02/2026', '2026-02-03', -20.00, 'FLOW B', '')
	`)
	if err != nil {
		t.Fatalf("seed transactions: %v", err)
	}
	m = flowRefresh(t, m)
	m.activeTab = tabManager
	m.managerMode = managerModeTransactions

	filtered := m.getFilteredRows()
	if len(filtered) < 2 {
		t.Fatalf("need at least 2 rows, got %d", len(filtered))
	}
	idA := filtered[0].id
	idB := filtered[1].id

	m = flowPress(t, m, " ")
	m = flowPress(t, m, "j")
	m = flowPress(t, m, " ")
	if !m.selectedRows[idA] || !m.selectedRows[idB] {
		t.Fatalf("selectedRows = %v, want ids %d and %d selected", m.selectedRows, idA, idB)
	}

	m = flowPress(t, m, "c")
	if m.catPicker == nil {
		t.Fatal("expected quick category picker open")
	}
	m = flowType(t, m, "groc")
	m = flowPress(t, m, "enter")
	if m.catPicker != nil {
		t.Fatal("expected quick category picker to close after apply")
	}

	txnA := loadTxnByID(t, m.db, idA)
	txnB := loadTxnByID(t, m.db, idB)
	if !strings.EqualFold(txnA.categoryName, "Groceries") || !strings.EqualFold(txnB.categoryName, "Groceries") {
		t.Fatalf("categories after quick categorize = [%q, %q], want both Groceries", txnA.categoryName, txnB.categoryName)
	}
	if !m.selectedRows[idA] || !m.selectedRows[idB] {
		t.Fatalf("selectedRows should persist after quick categorize, got %v", m.selectedRows)
	}

	m = flowPress(t, m, "t")
	if m.tagPicker == nil {
		t.Fatal("expected quick tag picker open")
	}
	m = flowPress(t, m, "enter")
	if m.tagPicker != nil {
		t.Fatal("expected quick tag picker to close after apply")
	}

	txnTags, err := loadTransactionTags(m.db)
	if err != nil {
		t.Fatalf("loadTransactionTags: %v", err)
	}
	if !hasTagNamed(txnTags[idA], mandatoryIgnoreTagName) {
		t.Fatalf("txn %d missing %q tag after quick tag", idA, mandatoryIgnoreTagName)
	}
	if !hasTagNamed(txnTags[idB], mandatoryIgnoreTagName) {
		t.Fatalf("txn %d missing %q tag after quick tag", idB, mandatoryIgnoreTagName)
	}
}

func TestFlowCommandPaletteImportCommandCompletesImport(t *testing.T) {
	m, cleanup := newFlowModelWithDB(t)
	defer cleanup()

	base := t.TempDir()
	m.basePath = base
	writeFlowCSV(t, base, "ANZ-command.csv", "3/02/2026,-11.00,PALETTE A\n")

	m = flowApplyMsg(t, m, tea.KeyMsg{Type: tea.KeyCtrlK})
	if !m.commandOpen {
		t.Fatal("expected command palette open")
	}
	m = flowType(t, m, "import")
	m = flowPress(t, m, "enter")

	if m.activeTab != tabSettings || !m.settActive || m.settSection != settSecDBImport {
		t.Fatalf("post-command state: tab=%d settActive=%v settSection=%d", m.activeTab, m.settActive, m.settSection)
	}
	if !m.importPicking {
		t.Fatal("expected import picker open after import command")
	}

	m = flowPress(t, m, "enter")
	if m.statusErr {
		t.Fatalf("import via command failed: %q", m.status)
	}
	rows, err := loadRows(m.db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows after command import = %d, want 1", len(rows))
	}
}

func TestFlowSettingsRowsPerPageSaveAndReload(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())

	m := newModel()
	m.activeTab = tabSettings
	m.settColumn = settColRight
	m.settSection = settSecDBImport
	m.settActive = true

	before := m.maxVisibleRows
	m = flowPress(t, m, "+")
	if m.maxVisibleRows != min(50, before+1) {
		t.Fatalf("maxVisibleRows after + = %d, want %d", m.maxVisibleRows, min(50, before+1))
	}
	if m.statusErr {
		t.Fatalf("unexpected settings save error: %q", m.status)
	}

	reloaded := newModel()
	if reloaded.maxVisibleRows != m.maxVisibleRows {
		t.Fatalf("reloaded maxVisibleRows = %d, want %d", reloaded.maxVisibleRows, m.maxVisibleRows)
	}
}

func TestFlowDetailEditSaveAndReopenShowsPersistedNotes(t *testing.T) {
	m, cleanup := newFlowModelWithDB(t)
	defer cleanup()

	res, err := m.db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes)
		VALUES ('03/02/2026', '2026-02-03', -12.34, 'DETAIL FLOW', 'seed')
	`)
	if err != nil {
		t.Fatalf("insert detail txn: %v", err)
	}
	lastID, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("last insert id: %v", err)
	}
	targetID := int(lastID)
	m = flowRefresh(t, m)
	m.activeTab = tabManager
	m.managerMode = managerModeTransactions

	m = flowPress(t, m, "enter")
	if !m.showDetail {
		t.Fatal("expected detail modal open")
	}
	if m.detailIdx != targetID {
		t.Fatalf("detailIdx = %d, want %d", m.detailIdx, targetID)
	}

	editKey := m.primaryActionKey(scopeDetailModal, actionEdit, "n")
	m = flowPress(t, m, editKey)
	m = flowPress(t, m, "x")
	m = flowPress(t, m, "enter")
	m = flowPress(t, m, "enter")

	if m.showDetail {
		t.Fatal("detail modal should close after save")
	}
	if m.statusErr {
		t.Fatalf("detail save status error: %q", m.status)
	}
	txn := loadTxnByID(t, m.db, targetID)
	if txn.notes != "seedx" {
		t.Fatalf("saved notes = %q, want %q", txn.notes, "seedx")
	}

	m = flowPress(t, m, "enter")
	if !m.showDetail {
		t.Fatal("expected detail modal to reopen")
	}
	if m.detailNotes != "seedx" {
		t.Fatalf("reopened detailNotes = %q, want %q", m.detailNotes, "seedx")
	}
}

func TestFlowImportMissingMappedAccountShowsErrorAndNoPartialState(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	db, cleanup := testDB(t)
	defer cleanup()

	base := t.TempDir()
	writeFlowCSV(t, base, "ANZ-missing.csv", "3/02/2026,-9.99,MISSING ACCOUNT FLOW\n")

	m := newModel()
	m.db = db
	m.ready = true
	m.basePath = base
	m.activeTab = tabSettings
	m.formats = []csvFormat{
		{
			Name:         "ANZ",
			DateFormat:   "2/01/2006",
			HasHeader:    false,
			Delimiter:    ",",
			DateCol:      0,
			AmountCol:    1,
			DescCol:      2,
			DescJoin:     true,
			Account:      "Missing Flow Account",
			AccountType:  "credit",
			ImportPrefix: "anz",
		},
	}
	m = flowRefresh(t, m)

	m = flowPress(t, m, "i")
	m = flowPress(t, m, "enter")

	if !m.statusErr {
		t.Fatalf("expected error status, got %q", m.status)
	}
	if !strings.Contains(m.status, "account") || !strings.Contains(m.status, "not found") {
		t.Fatalf("expected missing-account error status, got %q", m.status)
	}
	rows, err := loadRows(m.db)
	if err != nil {
		t.Fatalf("loadRows after missing-account import: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("rows should remain 0, got %d", len(rows))
	}
	imports, err := loadImports(m.db)
	if err != nil {
		t.Fatalf("loadImports after missing-account import: %v", err)
	}
	if len(imports) != 0 {
		t.Fatalf("imports should remain 0, got %d", len(imports))
	}
}
