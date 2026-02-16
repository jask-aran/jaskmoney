package main

import (
	"strings"
	"testing"
)

func TestRenderFilterEditorModalShowsScopedMatchCount(t *testing.T) {
	m := newModel()
	m.filterEditOpen = true
	m.filterEditExpr = `desc:coffee`
	m.rows = []transaction{
		{id: 1, description: "COFFEE SHOP"},
		{id: 2, description: "GROCERY"},
	}
	m.txnTags = map[int][]tag{}

	out := renderFilterEditorModal(m)
	if !strings.Contains(out, "1 txns") {
		t.Fatalf("expected scoped match count in filter editor modal, got: %q", out)
	}
}

func TestRenderRuleEditorModalShowsScopedMatchCount(t *testing.T) {
	m := newModel()
	m.ruleEditorOpen = true
	m.ruleEditorFilterID = "coffee"
	m.savedFilters = []savedFilter{
		{ID: "coffee", Name: "Coffee", Expr: `desc:coffee`},
	}
	m.rows = []transaction{
		{id: 1, description: "COFFEE SHOP"},
		{id: 2, description: "GROCERY"},
	}
	m.txnTags = map[int][]tag{}

	out := renderRuleEditorModal(m)
	if !strings.Contains(out, "1 txns") {
		t.Fatalf("expected scoped match count in rule editor modal, got: %q", out)
	}
}
