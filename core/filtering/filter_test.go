package filtering

import "testing"

func mustParse(t *testing.T, expr string) *Node {
	t.Helper()
	node, err := Parse(expr)
	if err != nil {
		t.Fatalf("Parse(%q): %v", expr, err)
	}
	return node
}

func mustParseStrict(t *testing.T, expr string) *Node {
	t.Helper()
	node, err := ParseStrict(expr)
	if err != nil {
		t.Fatalf("ParseStrict(%q): %v", expr, err)
	}
	return node
}

func TestStrictRejectsUngroupedMixedBoolean(t *testing.T) {
	if _, err := ParseStrict("cat:Food OR cat:Transport AND amt:>50"); err == nil {
		t.Fatalf("expected strict grouping parse error")
	}
}

func TestStrictAllowsGroupedMixedBoolean(t *testing.T) {
	node := mustParseStrict(t, "(cat:Food OR cat:Transport) AND amt:>50")
	if node == nil {
		t.Fatalf("expected parse tree")
	}
}

func TestEvalAllCoreFields(t *testing.T) {
	row := Row{
		Description:  "Coffee Shop",
		CategoryName: "Food",
		AccountName:  "ANZ Savings",
		Amount:       -120.50,
		DateISO:      "2025-03-15",
		Notes:        "refund processed",
		TagNames:     []string{"Groceries", "IGNORE"},
	}
	cases := []string{
		"desc:coffee",
		"cat:Food",
		"tag:Groceries",
		`acc:"ANZ Savings"`,
		"amt:<-100",
		"amt:-130..-100",
		"type:debit",
		"note:refund",
		"date:2025-03-15",
		"date:2025-03",
		"date:2025-01..2025-03",
	}
	for _, expr := range cases {
		if !Eval(mustParse(t, expr), row) {
			t.Fatalf("expected match for %q", expr)
		}
	}
}

func TestRoundTripCanonicalForm(t *testing.T) {
	node := mustParseStrict(t, "(cat:Food OR NOT tag:ignore) AND amt:>50")
	canonical := String(node)
	rt := mustParseStrict(t, canonical)
	if String(rt) != canonical {
		t.Fatalf("canonical roundtrip mismatch: %q vs %q", canonical, String(rt))
	}
}
