package main

import (
	"os"
	"path/filepath"
	"testing"
)

// testANZFormat returns the default ANZ format for testing.
func testANZFormat() csvFormat {
	return csvFormat{
		Name:        "ANZ",
		DateFormat:  "2/01/2006",
		HasHeader:   false,
		Delimiter:   ",",
		DateCol:     0,
		AmountCol:   1,
		DescCol:     2,
		DescJoin:    true,
		AmountStrip: ",",
	}
}

// ---------------------------------------------------------------------------
// CSV import tests
// ---------------------------------------------------------------------------

func writeTestCSV(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "test.csv")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write test csv: %v", err)
	}
	return path
}

func TestImportCSVBasic(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	csv := "3/02/2026,-20.00,DAN MURPHYS\n4/02/2026,203.92,PAYMENT RECEIVED\n"
	path := writeTestCSV(t, csv)

	inserted, dupes, err := importCSV(db, path, testANZFormat(), true)
	if err != nil {
		t.Fatalf("importCSV: %v", err)
	}
	if inserted != 2 {
		t.Errorf("inserted = %d, want 2", inserted)
	}
	if dupes != 0 {
		t.Errorf("dupes = %d, want 0", dupes)
	}

	rows, _ := loadRows(db)
	if len(rows) != 2 {
		t.Errorf("expected 2 rows in DB, got %d", len(rows))
	}
}

func TestImportCSVSkipsDuplicates(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	csv := "3/02/2026,-20.00,DAN MURPHYS\n4/02/2026,203.92,PAYMENT RECEIVED\n"
	path := writeTestCSV(t, csv)

	// First import
	inserted1, dupes1, err := importCSV(db, path, testANZFormat(), true)
	if err != nil {
		t.Fatalf("first import: %v", err)
	}
	if inserted1 != 2 || dupes1 != 0 {
		t.Errorf("first: inserted=%d dupes=%d, want 2/0", inserted1, dupes1)
	}

	// Second import of same file — all duplicates
	inserted2, dupes2, err := importCSV(db, path, testANZFormat(), true)
	if err != nil {
		t.Fatalf("second import: %v", err)
	}
	if inserted2 != 0 {
		t.Errorf("second: inserted = %d, want 0", inserted2)
	}
	if dupes2 != 2 {
		t.Errorf("second: dupes = %d, want 2", dupes2)
	}

	// DB should still have only 2 rows
	rows, _ := loadRows(db)
	if len(rows) != 2 {
		t.Errorf("expected 2 rows after re-import, got %d", len(rows))
	}
}

func TestImportCSVPartialDuplicates(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	csv1 := "3/02/2026,-20.00,DAN MURPHYS\n"
	path1 := writeTestCSV(t, csv1)
	_, _, _ = importCSV(db, path1, testANZFormat(), true)

	// Second file has one duplicate and one new
	csv2 := "3/02/2026,-20.00,DAN MURPHYS\n5/02/2026,-55.30,WOOLWORTHS\n"
	path2 := writeTestCSV(t, csv2)

	inserted, dupes, err := importCSV(db, path2, testANZFormat(), true)
	if err != nil {
		t.Fatalf("importCSV: %v", err)
	}
	if inserted != 1 {
		t.Errorf("inserted = %d, want 1", inserted)
	}
	if dupes != 1 {
		t.Errorf("dupes = %d, want 1", dupes)
	}
}

func TestImportCSVDuplicatesCaseInsensitive(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	csv1 := "3/02/2026,-20.00,DAN MURPHYS\n"
	path1 := writeTestCSV(t, csv1)
	_, _, _ = importCSV(db, path1, testANZFormat(), true)

	// Same transaction but different case
	csv2 := "3/02/2026,-20.00,dan murphys\n"
	path2 := writeTestCSV(t, csv2)

	inserted, dupes, err := importCSV(db, path2, testANZFormat(), true)
	if err != nil {
		t.Fatalf("importCSV: %v", err)
	}
	if inserted != 0 {
		t.Errorf("inserted = %d, want 0 (case-insensitive match)", inserted)
	}
	if dupes != 1 {
		t.Errorf("dupes = %d, want 1", dupes)
	}
}

func TestImportCSVDifferentAmountNotDuplicate(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	csv1 := "3/02/2026,-20.00,DAN MURPHYS\n"
	path1 := writeTestCSV(t, csv1)
	_, _, _ = importCSV(db, path1, testANZFormat(), true)

	// Same date+desc but different amount — NOT a duplicate
	csv2 := "3/02/2026,-25.00,DAN MURPHYS\n"
	path2 := writeTestCSV(t, csv2)

	inserted, dupes, err := importCSV(db, path2, testANZFormat(), true)
	if err != nil {
		t.Fatalf("importCSV: %v", err)
	}
	if inserted != 1 {
		t.Errorf("inserted = %d, want 1 (different amount)", inserted)
	}
	if dupes != 0 {
		t.Errorf("dupes = %d, want 0", dupes)
	}
}

func TestImportCSVDuplicatesWithinSameFile(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	// Two identical rows in same file — second should be skipped
	csv := "3/02/2026,-20.00,DAN MURPHYS\n3/02/2026,-20.00,DAN MURPHYS\n"
	path := writeTestCSV(t, csv)

	inserted, dupes, err := importCSV(db, path, testANZFormat(), true)
	if err != nil {
		t.Fatalf("importCSV: %v", err)
	}
	if inserted != 1 {
		t.Errorf("inserted = %d, want 1", inserted)
	}
	if dupes != 1 {
		t.Errorf("dupes = %d, want 1", dupes)
	}
}

func TestImportCSVSkipsShortRows(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	csv := "3/02/2026,-20.00\n4/02/2026,203.92,VALID ROW\n"
	path := writeTestCSV(t, csv)

	inserted, _, err := importCSV(db, path, testANZFormat(), true)
	if err != nil {
		t.Fatalf("importCSV: %v", err)
	}
	if inserted != 1 {
		t.Errorf("inserted = %d, want 1 (short row skipped)", inserted)
	}
}

func TestImportCSVBadDateFails(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	csv := "not-a-date,-20.00,DAN MURPHYS\n"
	path := writeTestCSV(t, csv)

	_, _, err := importCSV(db, path, testANZFormat(), true)
	if err == nil {
		t.Error("expected error for bad date")
	}
}

func TestImportCSVBadRowRollsBackNoPartialWrites(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	// First row is valid, second row is invalid date. Import should fail and roll
	// back all writes from this file.
	csv := "3/02/2026,-20.00,VALID FIRST ROW\nnot-a-date,-12.00,BAD SECOND ROW\n"
	path := writeTestCSV(t, csv)

	inserted, _, err := importCSV(db, path, testANZFormat(), true)
	if err == nil {
		t.Fatal("expected importCSV error for invalid row")
	}
	// Implementation tracks inserted rows before parse failure; DB must still be
	// unchanged due transaction rollback.
	if inserted != 1 {
		t.Fatalf("inserted count before rollback = %d, want 1", inserted)
	}

	rows, loadErr := loadRows(db)
	if loadErr != nil {
		t.Fatalf("loadRows: %v", loadErr)
	}
	if len(rows) != 0 {
		t.Fatalf("rows in DB after failed import = %d, want 0", len(rows))
	}
}

func TestImportCSVBadAmountFails(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	csv := "3/02/2026,abc,DAN MURPHYS\n"
	path := writeTestCSV(t, csv)

	_, _, err := importCSV(db, path, testANZFormat(), true)
	if err == nil {
		t.Error("expected error for bad amount")
	}
}

func TestImportCSVJoinsDescriptionColumns(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	csv := "3/02/2026,-20.00,DAN MURPHYS,580 MELBOURN,SP\n"
	path := writeTestCSV(t, csv)

	_, _, err := importCSV(db, path, testANZFormat(), true)
	if err != nil {
		t.Fatalf("importCSV: %v", err)
	}

	rows, _ := loadRows(db)
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	// Columns 2+ should be joined with comma
	if rows[0].description != "DAN MURPHYS,580 MELBOURN,SP" {
		t.Errorf("description = %q, want joined columns", rows[0].description)
	}
}

func TestImportCSVFileNotFound(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	_, _, err := importCSV(db, "/nonexistent/file.csv", testANZFormat(), true)
	if err == nil {
		t.Error("expected error for nonexistent file")
	}
}

func TestImportCSVForAccountAssignsAccountID(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	accountID, err := insertAccount(db, "Spending", "debit", true)
	if err != nil {
		t.Fatalf("insertAccount: %v", err)
	}

	csv := "3/02/2026,-20.00,DAN MURPHYS\n"
	path := writeTestCSV(t, csv)
	inserted, dupes, err := importCSVForAccount(db, path, testANZFormat(), &accountID, true)
	if err != nil {
		t.Fatalf("importCSVForAccount: %v", err)
	}
	if inserted != 1 || dupes != 0 {
		t.Fatalf("inserted=%d dupes=%d, want 1/0", inserted, dupes)
	}

	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("expected 1 row, got %d", len(rows))
	}
	if rows[0].accountID == nil || *rows[0].accountID != accountID {
		t.Fatalf("accountID = %v, want %d", rows[0].accountID, accountID)
	}
	if rows[0].accountName != "Spending" {
		t.Fatalf("accountName = %q, want %q", rows[0].accountName, "Spending")
	}
}

func TestImportCSVForAccountNoSignFlipByAccountType(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	accountID, err := insertAccount(db, "Credit Card", "credit", true)
	if err != nil {
		t.Fatalf("insertAccount: %v", err)
	}

	csv := "3/02/2026,203.92,PAYMENT RECEIVED\n4/02/2026,-20.00,DAN MURPHYS\n"
	path := writeTestCSV(t, csv)
	if _, _, err := importCSVForAccount(db, path, testANZFormat(), &accountID, true); err != nil {
		t.Fatalf("importCSVForAccount: %v", err)
	}

	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("expected 2 rows, got %d", len(rows))
	}

	foundPositive := false
	foundNegative := false
	for _, row := range rows {
		if row.amount == 203.92 {
			foundPositive = true
		}
		if row.amount == -20.00 {
			foundNegative = true
		}
	}
	if !foundPositive || !foundNegative {
		t.Fatalf("expected original amount signs to be preserved, rows=%+v", rows)
	}
}

func TestImportCSVForAccountDuplicateDetectionIsAccountScoped(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	accountAID, err := insertAccount(db, "ACC_A", "credit", true)
	if err != nil {
		t.Fatalf("insert ACC_A: %v", err)
	}
	accountBID, err := insertAccount(db, "ACC_B", "debit", true)
	if err != nil {
		t.Fatalf("insert ACC_B: %v", err)
	}

	path := writeTestCSV(t, "3/02/2026,-25.00,SAME ROW\n")
	format := testANZFormat()

	ins1, dup1, err := importCSVForAccount(db, path, format, &accountAID, true)
	if err != nil {
		t.Fatalf("first import ACC_A: %v", err)
	}
	if ins1 != 1 || dup1 != 0 {
		t.Fatalf("ACC_A first import inserted/dupes = %d/%d, want 1/0", ins1, dup1)
	}

	ins2, dup2, err := importCSVForAccount(db, path, format, &accountAID, true)
	if err != nil {
		t.Fatalf("second import ACC_A: %v", err)
	}
	if ins2 != 0 || dup2 != 1 {
		t.Fatalf("ACC_A second import inserted/dupes = %d/%d, want 0/1", ins2, dup2)
	}

	ins3, dup3, err := importCSVForAccount(db, path, format, &accountBID, true)
	if err != nil {
		t.Fatalf("import ACC_B: %v", err)
	}
	if ins3 != 1 || dup3 != 0 {
		t.Fatalf("ACC_B import inserted/dupes = %d/%d, want 1/0", ins3, dup3)
	}
}

func TestIngestCmdFailsWhenMappedAccountMissing(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	dir := t.TempDir()
	file := "anz-test.csv"
	path := filepath.Join(dir, file)
	csv := "3/02/2026,-20.00,DAN MURPHYS\n"
	if err := os.WriteFile(path, []byte(csv), 0644); err != nil {
		t.Fatalf("write csv: %v", err)
	}

	formats := []csvFormat{
		{
			Name:         "ANZ",
			Account:      "Missing Account",
			ImportPrefix: "anz",
			DateFormat:   "2/01/2006",
			HasHeader:    false,
			Delimiter:    ",",
			DateCol:      0,
			AmountCol:    1,
			DescCol:      2,
			DescJoin:     true,
			AmountStrip:  ",",
		},
	}

	msg := ingestCmd(db, file, dir, formats, nil, true)()
	done, ok := msg.(ingestDoneMsg)
	if !ok {
		t.Fatalf("unexpected message type: %T", msg)
	}
	if done.err == nil {
		t.Fatal("expected ingest error for missing mapped account")
	}
}

func TestIngestCmdAppliesTagRules(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	accountID, err := insertAccount(db, "ANZ", "debit", true)
	if err != nil {
		t.Fatalf("insertAccount: %v", err)
	}
	tagID, err := insertTag(db, "grocery", "#94e2d5", nil)
	if err != nil {
		t.Fatalf("insertTag: %v", err)
	}
	if _, err := insertTagRule(db, "WOOLWORTHS", tagID); err != nil {
		t.Fatalf("insertTagRule: %v", err)
	}

	dir := t.TempDir()
	file := "anz-tag.csv"
	path := filepath.Join(dir, file)
	csv := "3/02/2026,-20.00,WOOLWORTHS METRO\n"
	if err := os.WriteFile(path, []byte(csv), 0644); err != nil {
		t.Fatalf("write csv: %v", err)
	}

	formats := []csvFormat{
		{
			Name:         "ANZ",
			Account:      "ANZ",
			ImportPrefix: "anz",
			DateFormat:   "2/01/2006",
			HasHeader:    false,
			Delimiter:    ",",
			DateCol:      0,
			AmountCol:    1,
			DescCol:      2,
			DescJoin:     true,
			AmountStrip:  ",",
		},
	}
	_ = accountID
	msg := ingestCmd(db, file, dir, formats, nil, true)()
	done, ok := msg.(ingestDoneMsg)
	if !ok {
		t.Fatalf("unexpected message type: %T", msg)
	}
	if done.err != nil {
		t.Fatalf("ingestCmd failed: %v", done.err)
	}

	txnTags, err := loadTransactionTags(db)
	if err != nil {
		t.Fatalf("loadTransactionTags: %v", err)
	}
	if len(txnTags) != 1 {
		t.Fatalf("expected tags for 1 transaction, got %+v", txnTags)
	}
}

func TestScanDupesCmdDoesNotMutateDB(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	accountID, err := insertAccount(db, "ANZ", "debit", true)
	if err != nil {
		t.Fatalf("insertAccount: %v", err)
	}
	format := testANZFormat()
	format.Account = "ANZ"
	format.ImportPrefix = "anz"

	seedPath := writeTestCSV(t, "3/02/2026,-20.00,SEED\n")
	if _, _, err := importCSVForAccount(db, seedPath, format, &accountID, true); err != nil {
		t.Fatalf("seed import: %v", err)
	}

	dir := t.TempDir()
	file := "ANZ-scan.csv"
	scanPath := filepath.Join(dir, file)
	// One row duplicates existing DB row; one row is an in-file duplicate.
	csv := "3/02/2026,-20.00,SEED\n3/02/2026,-20.00,SEED\n4/02/2026,-10.00,NEW\n"
	if err := os.WriteFile(scanPath, []byte(csv), 0o644); err != nil {
		t.Fatalf("write scan csv: %v", err)
	}

	msg := scanDupesCmd(db, file, dir, []csvFormat{format}, nil)()
	done, ok := msg.(importPreviewMsg)
	if !ok {
		t.Fatalf("unexpected message type: %T", msg)
	}
	if done.err != nil {
		t.Fatalf("scanDupesCmd error: %v", done.err)
	}
	if done.snapshot == nil {
		t.Fatal("expected non-nil snapshot")
	}
	if done.snapshot.totalRows != 3 {
		t.Fatalf("scan total=%d, want 3", done.snapshot.totalRows)
	}
	if done.snapshot.dupeCount != 2 {
		t.Fatalf("scan dupes=%d, want 2", done.snapshot.dupeCount)
	}
	if done.snapshot.newCount != 1 {
		t.Fatalf("newCount=%d, want 1", done.snapshot.newCount)
	}
	if done.snapshot.errorCount != 0 {
		t.Fatalf("errorCount=%d, want 0", done.snapshot.errorCount)
	}
	if len(done.snapshot.rows) != 3 {
		t.Fatalf("rows len=%d, want 3", len(done.snapshot.rows))
	}
	if !done.snapshot.rows[0].isDupe || !done.snapshot.rows[1].isDupe || done.snapshot.rows[2].isDupe {
		t.Fatalf("unexpected dupe flags: [%v %v %v]", done.snapshot.rows[0].isDupe, done.snapshot.rows[1].isDupe, done.snapshot.rows[2].isDupe)
	}

	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("scan should not mutate DB rows, got %d want 1", len(rows))
	}
}

func TestScanDupesCmdCollectsParseErrors(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	accountID, err := insertAccount(db, "ANZ", "debit", true)
	if err != nil {
		t.Fatalf("insertAccount: %v", err)
	}
	_ = accountID

	format := testANZFormat()
	format.Account = "ANZ"
	format.ImportPrefix = "anz"

	dir := t.TempDir()
	file := "ANZ-errors.csv"
	path := filepath.Join(dir, file)
	csv := "3/02/2026,-20.00,VALID\nnot-a-date,-11.00,BAD DATE\n4/02/2026,,MISSING AMOUNT\n"
	if err := os.WriteFile(path, []byte(csv), 0o644); err != nil {
		t.Fatalf("write csv: %v", err)
	}

	msg := scanDupesCmd(db, file, dir, []csvFormat{format}, nil)()
	done, ok := msg.(importPreviewMsg)
	if !ok {
		t.Fatalf("unexpected message type: %T", msg)
	}
	if done.err != nil {
		t.Fatalf("scanDupesCmd error: %v", done.err)
	}
	if done.snapshot == nil {
		t.Fatal("expected non-nil snapshot")
	}
	if done.snapshot.totalRows != 3 {
		t.Fatalf("totalRows=%d, want 3", done.snapshot.totalRows)
	}
	if done.snapshot.errorCount != 2 {
		t.Fatalf("errorCount=%d, want 2", done.snapshot.errorCount)
	}
	if len(done.snapshot.parseErrors) != 2 {
		t.Fatalf("parseErrors len=%d, want 2", len(done.snapshot.parseErrors))
	}
	if done.snapshot.parseErrors[0].sourceLine != 2 {
		t.Fatalf("first parse error sourceLine=%d, want 2", done.snapshot.parseErrors[0].sourceLine)
	}
	if done.snapshot.parseErrors[1].sourceLine != 3 {
		t.Fatalf("second parse error sourceLine=%d, want 3", done.snapshot.parseErrors[1].sourceLine)
	}
}

func TestScanDupesCmdIgnoresBlankTrailingRows(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	if _, err := insertAccount(db, "ANZ", "debit", true); err != nil {
		t.Fatalf("insertAccount: %v", err)
	}

	format := testANZFormat()
	format.Account = "ANZ"
	format.ImportPrefix = "anz"

	dir := t.TempDir()
	file := "ANZ-blank-lines.csv"
	path := filepath.Join(dir, file)
	csv := "3/02/2026,-20.00,VALID\n\n"
	if err := os.WriteFile(path, []byte(csv), 0o644); err != nil {
		t.Fatalf("write csv: %v", err)
	}

	msg := scanDupesCmd(db, file, dir, []csvFormat{format}, nil)()
	done, ok := msg.(importPreviewMsg)
	if !ok {
		t.Fatalf("unexpected message type: %T", msg)
	}
	if done.err != nil {
		t.Fatalf("scanDupesCmd error: %v", done.err)
	}
	if done.snapshot == nil {
		t.Fatal("expected non-nil snapshot")
	}
	if done.snapshot.errorCount != 0 {
		t.Fatalf("errorCount=%d, want 0", done.snapshot.errorCount)
	}
	if done.snapshot.totalRows != 1 {
		t.Fatalf("totalRows=%d, want 1", done.snapshot.totalRows)
	}
}

func TestScanDupesCmdDoesNotMarkWithinFileRepeatsAsDupesOnEmptyDB(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	if _, err := insertAccount(db, "ANZ", "debit", true); err != nil {
		t.Fatalf("insertAccount: %v", err)
	}

	format := testANZFormat()
	format.Account = "ANZ"
	format.ImportPrefix = "anz"

	dir := t.TempDir()
	file := "ANZ-repeat.csv"
	path := filepath.Join(dir, file)
	csv := "3/02/2026,-20.00,SAME\n3/02/2026,-20.00,SAME\n"
	if err := os.WriteFile(path, []byte(csv), 0o644); err != nil {
		t.Fatalf("write csv: %v", err)
	}

	msg := scanDupesCmd(db, file, dir, []csvFormat{format}, nil)()
	done, ok := msg.(importPreviewMsg)
	if !ok {
		t.Fatalf("unexpected message type: %T", msg)
	}
	if done.err != nil {
		t.Fatalf("scanDupesCmd error: %v", done.err)
	}
	if done.snapshot == nil {
		t.Fatal("expected non-nil snapshot")
	}
	if done.snapshot.dupeCount != 0 {
		t.Fatalf("dupeCount=%d, want 0 for within-file repeats on empty DB", done.snapshot.dupeCount)
	}
}

func TestIngestSnapshotCmdSkipDupesUsesSnapshotRows(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	accountID, err := insertAccount(db, "ANZ", "debit", true)
	if err != nil {
		t.Fatalf("insertAccount: %v", err)
	}
	format := testANZFormat()
	format.Account = "ANZ"
	format.ImportPrefix = "anz"

	seedPath := writeTestCSV(t, "3/02/2026,-20.00,SEED\n")
	if _, _, err := importCSVForAccount(db, seedPath, format, &accountID, true); err != nil {
		t.Fatalf("seed import: %v", err)
	}

	dir := t.TempDir()
	file := "ANZ-snapshot.csv"
	path := filepath.Join(dir, file)
	csv := "3/02/2026,-20.00,SEED\n3/02/2026,-20.00,SEED\n4/02/2026,-10.00,NEW\n"
	if err := os.WriteFile(path, []byte(csv), 0o644); err != nil {
		t.Fatalf("write csv: %v", err)
	}

	previewMsg := scanDupesCmd(db, file, dir, []csvFormat{format}, nil)()
	preview, ok := previewMsg.(importPreviewMsg)
	if !ok {
		t.Fatalf("unexpected message type: %T", previewMsg)
	}
	if preview.err != nil {
		t.Fatalf("scanDupesCmd error: %v", preview.err)
	}
	if preview.snapshot == nil {
		t.Fatal("expected snapshot")
	}

	doneMsg := ingestSnapshotCmd(db, preview.snapshot, true)()
	done, ok := doneMsg.(ingestDoneMsg)
	if !ok {
		t.Fatalf("unexpected ingest message type: %T", doneMsg)
	}
	if done.err != nil {
		t.Fatalf("ingestSnapshotCmd error: %v", done.err)
	}
	if done.count != 1 {
		t.Fatalf("count=%d, want 1", done.count)
	}
	if done.dupes != 2 {
		t.Fatalf("dupes=%d, want 2", done.dupes)
	}

	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows len=%d, want 2", len(rows))
	}
}

func TestIngestSnapshotCmdUsesLockedRules(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	_, err := insertAccount(db, "ANZ", "debit", true)
	if err != nil {
		t.Fatalf("insertAccount: %v", err)
	}
	cats, err := loadCategories(db)
	if err != nil {
		t.Fatalf("loadCategories: %v", err)
	}
	var groceriesID int
	for _, cat := range cats {
		if cat.name == "Groceries" {
			groceriesID = cat.id
			break
		}
	}
	if groceriesID == 0 {
		t.Fatal("expected Groceries category")
	}

	ruleID, err := insertRuleV2(db, ruleV2{
		name:          "Groceries rule",
		savedFilterID: "filter-grocery",
		setCategoryID: &groceriesID,
		enabled:       true,
	})
	if err != nil {
		t.Fatalf("insertRuleV2: %v", err)
	}

	format := testANZFormat()
	format.Account = "ANZ"
	format.ImportPrefix = "anz"

	dir := t.TempDir()
	file := "ANZ-locked-rules.csv"
	path := filepath.Join(dir, file)
	csv := "3/02/2026,-20.00,WOOLWORTHS LOCK TEST\n"
	if err := os.WriteFile(path, []byte(csv), 0o644); err != nil {
		t.Fatalf("write csv: %v", err)
	}

	savedFilters := []savedFilter{
		{ID: "filter-grocery", Name: "Groceries", Expr: `desc:woolworths`},
	}
	previewMsg := scanDupesCmd(db, file, dir, []csvFormat{format}, savedFilters)()
	preview, ok := previewMsg.(importPreviewMsg)
	if !ok {
		t.Fatalf("unexpected message type: %T", previewMsg)
	}
	if preview.err != nil {
		t.Fatalf("scanDupesCmd error: %v", preview.err)
	}
	if preview.snapshot == nil {
		t.Fatal("expected snapshot")
	}
	if len(preview.snapshot.rows) != 1 {
		t.Fatalf("snapshot rows len=%d, want 1", len(preview.snapshot.rows))
	}
	if preview.snapshot.rows[0].previewCat != "Groceries" {
		t.Fatalf("preview category=%q, want Groceries", preview.snapshot.rows[0].previewCat)
	}

	rules, err := loadRulesV2(db)
	if err != nil {
		t.Fatalf("loadRulesV2: %v", err)
	}
	for _, r := range rules {
		if r.id != ruleID {
			continue
		}
		r.enabled = false
		if err := updateRuleV2(db, r); err != nil {
			t.Fatalf("disable rule: %v", err)
		}
	}

	doneMsg := ingestSnapshotCmd(db, preview.snapshot, true)()
	done, ok := doneMsg.(ingestDoneMsg)
	if !ok {
		t.Fatalf("unexpected ingest message type: %T", doneMsg)
	}
	if done.err != nil {
		t.Fatalf("ingestSnapshotCmd error: %v", done.err)
	}

	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 1 {
		t.Fatalf("rows len=%d, want 1", len(rows))
	}
	if rows[0].categoryName != "Groceries" {
		t.Fatalf("imported category=%q, want Groceries (locked preview parity)", rows[0].categoryName)
	}
}

func TestIngestSnapshotCmdBlocksOnParseErrorsWithoutWrites(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	if _, err := insertAccount(db, "ANZ", "debit", true); err != nil {
		t.Fatalf("insertAccount: %v", err)
	}
	format := testANZFormat()
	format.Account = "ANZ"
	format.ImportPrefix = "anz"

	dir := t.TempDir()
	file := "ANZ-blocked.csv"
	path := filepath.Join(dir, file)
	csv := "3/02/2026,-20.00,VALID\nnot-a-date,-10.00,BAD\n"
	if err := os.WriteFile(path, []byte(csv), 0o644); err != nil {
		t.Fatalf("write csv: %v", err)
	}

	previewMsg := scanDupesCmd(db, file, dir, []csvFormat{format}, nil)()
	preview, ok := previewMsg.(importPreviewMsg)
	if !ok {
		t.Fatalf("unexpected message type: %T", previewMsg)
	}
	if preview.err != nil {
		t.Fatalf("scanDupesCmd error: %v", preview.err)
	}
	if preview.snapshot == nil || preview.snapshot.errorCount == 0 {
		t.Fatalf("expected parse errors in snapshot, got %+v", preview.snapshot)
	}

	doneMsg := ingestSnapshotCmd(db, preview.snapshot, true)()
	done, ok := doneMsg.(ingestDoneMsg)
	if !ok {
		t.Fatalf("unexpected ingest message type: %T", doneMsg)
	}
	if done.err == nil {
		t.Fatal("expected import failure when snapshot contains parse errors")
	}

	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	if len(rows) != 0 {
		t.Fatalf("rows len=%d, want 0", len(rows))
	}
}

// ---------------------------------------------------------------------------
// Helper function tests
// ---------------------------------------------------------------------------

func TestDuplicateKey(t *testing.T) {
	k1 := duplicateKey("2026-02-03", -20.00, "DAN MURPHYS")
	k2 := duplicateKey("2026-02-03", -20.00, "dan murphys")
	if k1 != k2 {
		t.Errorf("case-insensitive keys should match: %q != %q", k1, k2)
	}

	k3 := duplicateKey("2026-02-03", -25.00, "DAN MURPHYS")
	if k1 == k3 {
		t.Error("different amounts should produce different keys")
	}

	k4 := duplicateKey("2026-02-04", -20.00, "DAN MURPHYS")
	if k1 == k4 {
		t.Error("different dates should produce different keys")
	}
}

func TestParseDateISO(t *testing.T) {
	tests := []struct {
		input string
		want  string
		err   bool
	}{
		{"3/02/2026", "2026-02-03", false},
		{"15/01/2026", "2026-01-15", false},
		{"1/01/2000", "2000-01-01", false},
		{"bad", "", true},
		{"", "", true},
	}
	for _, tt := range tests {
		got, err := parseDateISO(tt.input, "2/01/2006")
		if tt.err {
			if err == nil {
				t.Errorf("parseDateISO(%q) expected error", tt.input)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseDateISO(%q) unexpected error: %v", tt.input, err)
			continue
		}
		if got != tt.want {
			t.Errorf("parseDateISO(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestParseAmount(t *testing.T) {
	tests := []struct {
		input string
		want  float64
		err   bool
	}{
		{"-20.00", -20.00, false},
		{"203.92", 203.92, false},
		{"1,234.56", 1234.56, false},
		{"-1,234.56", -1234.56, false},
		{"abc", 0, true},
		{"", 0, true},
	}
	for _, tt := range tests {
		got, err := parseAmount(tt.input)
		if tt.err {
			if err == nil {
				t.Errorf("parseAmount(%q) expected error", tt.input)
			}
			continue
		}
		if err != nil {
			t.Errorf("parseAmount(%q) unexpected error: %v", tt.input, err)
			continue
		}
		if got != tt.want {
			t.Errorf("parseAmount(%q) = %f, want %f", tt.input, got, tt.want)
		}
	}
}

// ---------------------------------------------------------------------------
// Format detection tests
// ---------------------------------------------------------------------------

func TestDetectFormatByPrefix(t *testing.T) {
	formats := []csvFormat{
		{Name: "ANZ", DateFormat: "2/01/2006"},
		{Name: "CBA", DateFormat: "02/01/2006"},
	}
	f := detectFormat(formats, "ANZ.csv")
	if f == nil || f.Name != "ANZ" {
		t.Errorf("expected ANZ format, got %v", f)
	}
}

func TestDetectFormatCaseInsensitive(t *testing.T) {
	formats := []csvFormat{
		{Name: "ANZ", DateFormat: "2/01/2006"},
	}
	f := detectFormat(formats, "anz-export-2026.csv")
	if f == nil || f.Name != "ANZ" {
		t.Errorf("expected ANZ format for lowercase prefix, got %v", f)
	}
}

func TestDetectFormatFallback(t *testing.T) {
	formats := []csvFormat{
		{Name: "ANZ", DateFormat: "2/01/2006"},
	}
	f := detectFormat(formats, "unknown.csv")
	if f == nil || f.Name != "ANZ" {
		t.Errorf("expected fallback to first format, got %v", f)
	}
}

func TestDetectFormatNoFormats(t *testing.T) {
	f := detectFormat(nil, "test.csv")
	if f != nil {
		t.Error("expected nil when no formats available")
	}
}

func TestDetectFormatSelectsCorrect(t *testing.T) {
	formats := []csvFormat{
		{Name: "ANZ", DateFormat: "2/01/2006"},
		{Name: "CBA", DateFormat: "02/01/2006"},
	}
	f := detectFormat(formats, "CBA-statement.csv")
	if f == nil || f.Name != "CBA" {
		t.Errorf("expected CBA format, got %v", f)
	}
}
