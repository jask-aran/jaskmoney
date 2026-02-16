package main

import "testing"

func TestDetailOffsetLinkFlow(t *testing.T) {
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
	if got.offsetDebitPicker == nil {
		t.Fatal("offset debit picker should open")
	}

	next, _ = got.updateOffsetDebitPicker(keyMsg("enter"))
	got2 := next.(model)
	if got2.detailEditing != "offset_amount" {
		t.Fatalf("detailEditing = %q, want offset_amount", got2.detailEditing)
	}
	if got2.offsetDebitTxnID == 0 {
		t.Fatal("offset debit txn should be selected")
	}

	next, _ = got2.updateDetailOffsetAmount(keyMsg("enter"))
	got3 := next.(model)
	if got3.statusErr {
		t.Fatalf("expected successful insert, got status=%q", got3.status)
	}
	offsets, err := loadCreditOffsets(db)
	if err != nil {
		t.Fatalf("loadCreditOffsets: %v", err)
	}
	if len(offsets) != 1 {
		t.Fatalf("offset rows = %d, want 1", len(offsets))
	}
}
