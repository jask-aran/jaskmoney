package main

import (
	"fmt"
	"os"
	"path/filepath"
)

// runValidation executes a non-TUI validation path using a temporary DB and CSV.
func runValidation() error {
	dir, err := os.MkdirTemp("", "jaskmoney-validate-")
	if err != nil {
		return fmt.Errorf("create temp dir: %w", err)
	}
	defer os.RemoveAll(dir)

	dbPath := filepath.Join(dir, "validate.db")
	db, err := openDB(dbPath)
	if err != nil {
		return fmt.Errorf("open db: %w", err)
	}
	defer db.Close()

	formats, err := loadFormats()
	if err != nil {
		return fmt.Errorf("load formats: %w", err)
	}
	if len(formats) == 0 {
		return fmt.Errorf("no formats available")
	}

	csvPath := filepath.Join(dir, "ANZ-validate.csv")
	csv := "3/02/2026,-20.00,DAN MURPHYS\n4/02/2026,203.92,PAYMENT RECEIVED\n"
	if err := os.WriteFile(csvPath, []byte(csv), 0644); err != nil {
		return fmt.Errorf("write csv: %w", err)
	}

	base := filepath.Dir(csvPath)
	cmd := ingestCmd(db, filepath.Base(csvPath), base, formats, true)
	msg := cmd()
	res, ok := msg.(ingestDoneMsg)
	if !ok {
		return fmt.Errorf("unexpected message: %T", msg)
	}
	if res.err != nil {
		return fmt.Errorf("import failed: %w", res.err)
	}
	if res.count != 2 {
		return fmt.Errorf("imported rows = %d, want 2", res.count)
	}

	format := detectFormat(formats, filepath.Base(csvPath))
	if format == nil {
		return fmt.Errorf("detect format failed")
	}
	acct, err := loadAccountByNameCI(db, format.Account)
	if err != nil {
		return fmt.Errorf("load account: %w", err)
	}
	if acct == nil {
		return fmt.Errorf("mapped account not found: %s", format.Account)
	}
	total, dupes, err := countDuplicatesForAccount(db, csvPath, *format, &acct.id)
	if err != nil {
		return fmt.Errorf("count duplicates: %w", err)
	}
	if total != 2 {
		return fmt.Errorf("duplicate scan total = %d, want 2", total)
	}
	if dupes != total {
		return fmt.Errorf("expected all rows to be duplicates after import, got %d/%d", dupes, total)
	}
	return nil
}
