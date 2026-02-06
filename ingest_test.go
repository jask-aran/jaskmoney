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
