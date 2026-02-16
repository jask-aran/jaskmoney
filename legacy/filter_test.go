package main

import (
	"strings"
	"testing"
)

func mustParseFilterExpr(t *testing.T, input string) *filterNode {
	t.Helper()
	n, err := parseFilter(input)
	if err != nil {
		t.Fatalf("parseFilter(%q): %v", input, err)
	}
	return n
}

func mustParseFilterStrictExpr(t *testing.T, input string) *filterNode {
	t.Helper()
	n, err := parseFilterStrict(input)
	if err != nil {
		t.Fatalf("parseFilterStrict(%q): %v", input, err)
	}
	return n
}

func TestFilterParseCaseSensitivityLowercaseAndIsText(t *testing.T) {
	n := mustParseFilterExpr(t, "coffee and tea")
	txnWithAnd := transaction{description: "coffee and tea"}
	if !evalFilter(n, txnWithAnd, nil) {
		t.Fatal("expected lowercase and to behave as plain text term")
	}
	txnNoAnd := transaction{description: "coffee tea"}
	if evalFilter(n, txnNoAnd, nil) {
		t.Fatal("lowercase and should not be treated as boolean operator")
	}
}

func TestFilterParseImplicitANDTextTerms(t *testing.T) {
	n := mustParseFilterExpr(t, "coffee tea")
	if n.kind != filterNodeAnd || len(n.children) != 2 {
		t.Fatalf("expected implicit AND node, got kind=%v children=%d", n.kind, len(n.children))
	}
}

func TestFilterParseImplicitANDPredicates(t *testing.T) {
	n := mustParseFilterExpr(t, "cat:Food amt:>50")
	if n.kind != filterNodeAnd || len(n.children) != 2 {
		t.Fatalf("expected implicit AND between predicates, got kind=%v children=%d", n.kind, len(n.children))
	}
}

func TestFilterParseUnaryPrecedence(t *testing.T) {
	n := mustParseFilterExpr(t, "NOT cat:Food AND tag:Work")
	if n.kind != filterNodeAnd || len(n.children) != 2 {
		t.Fatalf("expected AND node, got kind=%v children=%d", n.kind, len(n.children))
	}
	if n.children[0].kind != filterNodeNot {
		t.Fatalf("expected first branch NOT node, got %v", n.children[0].kind)
	}
}

func TestFilterStrictRejectsMixedWithoutGrouping(t *testing.T) {
	_, err := parseFilterStrict("cat:Food OR cat:Transport AND amt:>50")
	if err == nil {
		t.Fatal("expected strict parse error for mixed AND/OR without grouping")
	}
	if !strings.Contains(strings.ToLower(err.Error()), "parentheses") {
		t.Fatalf("expected actionable grouping hint, got %v", err)
	}
}

func TestFilterStrictAllowsGroupedMixedExpression(t *testing.T) {
	n := mustParseFilterStrictExpr(t, "(cat:Food OR cat:Transport) AND amt:>50")
	if n.kind != filterNodeAnd {
		t.Fatalf("expected AND root, got %v", n.kind)
	}
}

func TestFilterStrictExpressionsAlsoParsePermissive(t *testing.T) {
	cases := []string{
		"cat:Food",
		"cat:Food AND tag:weekly",
		"(cat:Food OR cat:Transport) AND amt:>50",
		`desc:"coffee shop"`,
		"NOT tag:ignore",
	}
	for _, input := range cases {
		if _, err := parseFilterStrict(input); err != nil {
			t.Fatalf("strict parse failed unexpectedly for %q: %v", input, err)
		}
		if _, err := parseFilter(input); err != nil {
			t.Fatalf("permissive parse failed for strict-valid expression %q: %v", input, err)
		}
	}
}

func TestFilterParserQuotedValues(t *testing.T) {
	n := mustParseFilterExpr(t, `desc:"coffee shop" AND cat:"Dining & Drinks"`)
	txn := transaction{description: "best coffee shop", categoryName: "Dining & Drinks"}
	if !evalFilter(n, txn, nil) {
		t.Fatal("expected quoted field values to match")
	}
}

func TestFilterEvalAllFields(t *testing.T) {
	txn := transaction{
		dateISO:      "2025-03-15",
		amount:       -120.50,
		description:  "Coffee Shop",
		categoryName: "Food",
		accountName:  "ANZ Savings",
		notes:        "refund processed",
	}
	tags := []tag{{id: 1, name: "Groceries"}, {id: 2, name: "IGNORE"}}

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
		"date:25-03",
		"date:2025-01..2025-03",
	}
	for _, input := range cases {
		n := mustParseFilterExpr(t, input)
		if !evalFilter(n, txn, tags) {
			t.Fatalf("expected %q to match transaction", input)
		}
	}
}

func TestFilterEvalHandlesNilCategoryAccountAndEmptyTags(t *testing.T) {
	txn := transaction{description: "plain", categoryName: "Uncategorised", accountName: ""}
	if evalFilter(mustParseFilterExpr(t, "tag:Any"), txn, nil) {
		t.Fatal("tag predicate should not match with empty tags")
	}
	if evalFilter(mustParseFilterExpr(t, "acc:ANZ"), txn, nil) {
		t.Fatal("account predicate should not match empty account name")
	}
}

func TestFilterDateEndpointsInclusive(t *testing.T) {
	n := mustParseFilterExpr(t, "date:2025-01..2025-03")
	if !evalFilter(n, transaction{dateISO: "2025-01-01"}, nil) {
		t.Fatal("expected range to include start month first day")
	}
	if !evalFilter(n, transaction{dateISO: "2025-03-31"}, nil) {
		t.Fatal("expected range to include end month last day")
	}
}

func TestFilterStrictInvalidTokenNeverFallsBack(t *testing.T) {
	_, err := parseFilterStrict("cat:")
	if err == nil {
		t.Fatal("expected strict parse error")
	}
}

func TestFilterInputPermissiveFallbackOnParseError(t *testing.T) {
	m := newModel()
	m.filterInput = "cat:"
	m.reparseFilterInput()
	if m.filterExpr == nil {
		t.Fatal("expected fallback filter expression")
	}
	if m.filterInputErr == "" {
		t.Fatal("expected parse error to be tracked for indicator")
	}
	txn := transaction{description: "contains cat:"}
	if !evalFilter(m.filterExpr, txn, nil) {
		t.Fatal("fallback filter should behave as plain description contains")
	}
}

func TestFilterSerializerCanonicalUppercaseAndMinimalParens(t *testing.T) {
	n := mustParseFilterStrictExpr(t, "(cat:Food OR NOT tag:ignore) AND amt:>50")
	out := filterExprString(n)
	if strings.Contains(out, " and ") || strings.Contains(out, " or ") {
		t.Fatalf("expected canonical uppercase boolean operators, got %q", out)
	}
	rt := mustParseFilterStrictExpr(t, out)
	if filterExprString(rt) != out {
		t.Fatalf("canonical round-trip mismatch: %q vs %q", out, filterExprString(rt))
	}
}

func TestFilterBuildersComposeScopes(t *testing.T) {
	m := newModel()
	m.filterInput = "cat:Food"
	m.reparseFilterInput()
	m.accounts = []account{{id: 1, name: "ANZ"}, {id: 2, name: "Cash"}}
	m.filterAccounts = map[int]bool{2: true}
	m.dashTimeframe = dashTimeframeThisMonth

	txnFilter := m.buildTransactionFilter()
	txn := transaction{categoryName: "Food", accountName: "Cash"}
	if !evalFilter(txnFilter, txn, nil) {
		t.Fatal("transaction filter should include user expression + account scope")
	}

	dashFilter := m.buildDashboardScopeFilter()
	if dashFilter == nil {
		t.Fatal("dashboard scope filter should include timeframe/account composition")
	}
}

func TestBuildCustomModeFilterFromConfigModes(t *testing.T) {
	m := newModel()
	m.customPaneModes = []customPaneMode{{Pane: "net_cashflow", Name: "Renovation", Expr: "cat:Home AND amt:<0"}}
	n := m.buildCustomModeFilter("net_cashflow", "Renovation")
	if n == nil {
		t.Fatal("expected custom mode filter node")
	}
}
