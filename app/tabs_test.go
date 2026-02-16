package app

import (
	"database/sql"
	"testing"

	"jaskmoney-v2/core"
)

func TestTabsImplementCoreInterfaces(t *testing.T) {
	all := []core.Tab{NewDashboardTab(), NewManagerTab(), NewBudgetTab(), NewSettingsTab()}
	m := core.NewModel(all, core.NewKeyRegistry(nil), core.NewCommandRegistry(nil), &sql.DB{}, core.AppData{})
	for _, tab := range all {
		if tab.ID() == "" || tab.Title() == "" || tab.Scope() == "" {
			t.Fatalf("tab metadata should not be empty")
		}
		if tab.Build(&m) == nil {
			t.Fatalf("tab build should return widget")
		}
		if _, ok := tab.(core.PaneKeyHandler); !ok {
			t.Fatalf("tab should implement pane key handler")
		}
	}
}
