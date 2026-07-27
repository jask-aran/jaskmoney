package main

import "testing"

func TestDetailIgnoresAllocationShortcut(t *testing.T) {
	db, cleanup := testDB(t)
	defer cleanup()

	accountID, err := insertAccount(db, "Offset", "debit", true)
	if err != nil {
		t.Fatalf("insertAccount: %v", err)
	}
	if _, err := db.Exec(`
		INSERT INTO transactions (date_raw, date_iso, amount, description, notes, account_id)
		VALUES
			('10/01/2026','2026-01-10',30.00,'CREDIT','',?),
			('12/01/2026','2026-01-12',-20.00,'DEBIT','',?)
	`, accountID, accountID); err != nil {
		t.Fatalf("insert transactions: %v", err)
	}
	rows, err := loadRows(db)
	if err != nil {
		t.Fatalf("loadRows: %v", err)
	}
	var credit transaction
	for _, row := range rows {
		if row.amount > 0 {
			credit = row
			break
		}
	}
	if credit.id == 0 {
		t.Fatal("credit row not found")
	}

	m := newModel()
	m.db = db
	m.ready = true
	m.rows = rows
	m.showDetail = true
	m.detailIdx = credit.id

	next, _ := m.updateDetail(keyMsg("o"))
	got := next.(model)
	if got.allocationModalOpen {
		t.Fatal("allocation modal should remain closed from detail scope")
	}
	if got.detailEditing != "" {
		t.Fatalf("detailEditing = %q, want empty", got.detailEditing)
	}
}
