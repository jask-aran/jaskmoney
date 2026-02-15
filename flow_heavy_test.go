//go:build flowheavy

package main

import "testing"

func TestFlowHeavySettingsImportWithDupesForceAll(t *testing.T) {
	m, cleanup := newFlowModelWithDB(t)
	defer cleanup()

	base := t.TempDir()
	m.basePath = base
	m.activeTab = tabSettings
	writeFlowCSV(t, base, "ANZ-heavy.csv", "3/02/2026,-20.00,HEAVY FLOW\n4/02/2026,-30.00,HEAVY FLOW 2\n")

	m = flowPress(t, m, "i")
	m = flowPress(t, m, "enter")
	if !m.importPreviewOpen {
		t.Fatal("expected import preview before first import")
	}
	m = flowPress(t, m, "s")

	rows, err := loadRows(m.db)
	if err != nil {
		t.Fatalf("loadRows after first import: %v", err)
	}
	if len(rows) != 2 {
		t.Fatalf("rows after first import = %d, want 2", len(rows))
	}

	m = flowPress(t, m, "i")
	m = flowPress(t, m, "enter")
	if !m.importPreviewOpen {
		t.Fatal("expected import preview before force-all import")
	}
	m = flowPress(t, m, "a")
	if m.statusErr {
		t.Fatalf("force-all import status error: %q", m.status)
	}

	rows, err = loadRows(m.db)
	if err != nil {
		t.Fatalf("loadRows after force-all import: %v", err)
	}
	if len(rows) != 4 {
		t.Fatalf("rows after force-all import = %d, want 4", len(rows))
	}
}
