package core

import (
	"database/sql"
	"testing"
)

func TestSearchFiltersByScopeAndDisabled(t *testing.T) {
	reg := NewCommandRegistry([]Command{
		{ID: "a", Name: "Alpha", Scopes: []string{"tab:a"}},
		{ID: "b", Name: "Beta", Scopes: []string{"tab:b"}, Disabled: func(m *Model) (bool, string) { return true, "blocked" }},
	})
	m := NewModel(nil, NewKeyRegistry(nil), reg, &sql.DB{}, AppData{})
	resA := reg.Search("", "tab:a", &m)
	if len(resA) != 1 || resA[0].CommandID != "a" {
		t.Fatalf("expected only command a in tab:a, got %+v", resA)
	}
	resB := reg.Search("", "tab:b", &m)
	if len(resB) != 1 || !resB[0].Disabled || resB[0].Reason != "blocked" {
		t.Fatalf("expected disabled command in tab:b, got %+v", resB)
	}
}
