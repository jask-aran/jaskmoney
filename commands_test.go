package main

import (
	"testing"

	tea "github.com/charmbracelet/bubbletea"
)

func TestCommandRegistryHasExpectedCommands(t *testing.T) {
	reg := NewCommandRegistry(NewKeyRegistry(), nil)
	all := reg.All()
	want := map[string]bool{
		"nav:next-tab":        true,
		"nav:prev-tab":        true,
		"nav:dashboard":       true,
		"nav:manager":         true,
		"nav:budget":          true,
		"nav:settings":        true,
		"jump:activate":       true,
		"jump:cancel":         true,
		"txn:sort":            true,
		"txn:sort-dir":        true,
		"txn:select":          true,
		"txn:clear-selection": true,
		"txn:quick-category":  true,
		"txn:quick-tag":       true,
		"txn:detail":          true,
		"txn:jump-top":        true,
		"txn:jump-bottom":     true,
		"filter:open":         true,
		"filter:clear":        true,
		"filter:save":         true,
		"filter:apply":        true,
		"import:start":        true,
		"rules:apply":         true,
		"rules:dry-run":       true,
		"settings:clear-db":   true,
		"dash:timeframe":      true,
		"dash:mode-next":      true,
		"dash:mode-prev":      true,
		"dash:drill-down":     true,
		"palette:open":        true,
		"cmd:open":            true,
	}
	if len(all) != len(want) {
		t.Fatalf("command count = %d, want %d", len(all), len(want))
	}
	for _, cmd := range all {
		if !want[cmd.ID] {
			t.Fatalf("unexpected command ID %q", cmd.ID)
		}
	}
}

func TestCommandRegistryAddsSavedFilterCommands(t *testing.T) {
	reg := NewCommandRegistry(NewKeyRegistry(), []savedFilter{
		{ID: "groceries", Name: "Groceries", Expr: "cat:Groceries"},
	})
	all := reg.All()
	found := false
	for _, cmd := range all {
		if cmd.ID == "filter:apply:groceries" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected dynamic saved filter command to be registered")
	}
}

func TestCommandSearchIncludesDescriptionAndID(t *testing.T) {
	reg := NewCommandRegistry(NewKeyRegistry(), nil)
	m := newModel()

	byDesc := reg.Search("transaction", scopeTransactions, m, "")
	if len(byDesc) == 0 {
		t.Fatal("expected description matches")
	}

	byID := reg.Search("nav:set", scopeGlobal, m, "")
	found := false
	for _, match := range byID {
		if match.Command.ID == "nav:settings" {
			found = true
			break
		}
	}
	if !found {
		t.Fatalf("expected nav:settings in ID search results, got %+v", byID)
	}
}

func TestCommandSearchRespectsScope(t *testing.T) {
	reg := NewCommandRegistry(NewKeyRegistry(), nil)
	m := newModel()
	results := reg.Search("timeframe", scopeTransactions, m, "")
	for _, match := range results {
		if match.Command.ID == "dash:timeframe" {
			t.Fatalf("dashboard command leaked into transactions scope: %+v", match)
		}
	}
}

func TestCommandSearchPrefersMRUWhenMatched(t *testing.T) {
	reg := NewCommandRegistry(NewKeyRegistry(), nil)
	m := newModel()
	got := reg.Search("nav", scopeGlobal, m, "nav:manager")
	if len(got) == 0 {
		t.Fatal("expected search results")
	}
	if got[0].Command.ID != "nav:manager" {
		t.Fatalf("top command = %q, want nav:manager", got[0].Command.ID)
	}
}

func TestExecuteByIDRejectsScopeMismatch(t *testing.T) {
	reg := NewCommandRegistry(NewKeyRegistry(), nil)
	m := newModel()
	_, _, err := reg.ExecuteByID("dash:timeframe", scopeTransactions, m)
	if err == nil {
		t.Fatal("expected scope mismatch error")
	}
}

func TestExecuteSelectedCommandShowsDisabledReasonAtCursor(t *testing.T) {
	m := newModel()
	m.commandOpen = true
	m.commandSourceScope = scopeGlobal
	m.commandCursor = 0
	m.commandMatches = []CommandMatch{
		{
			Command:        Command{ID: "nav:budget"},
			Enabled:        false,
			DisabledReason: "Budget tab is not available in this build.",
		},
		{
			Command: Command{ID: "nav:settings"},
			Enabled: true,
		},
	}

	next, _ := m.executeSelectedCommand()
	got := next.(model)
	if got.activeTab == tabSettings {
		t.Fatalf("activeTab = %d, expected command not to execute", got.activeTab)
	}
	if got.lastCommandID != "" {
		t.Fatalf("lastCommandID = %q, want empty", got.lastCommandID)
	}
	if !got.commandOpen {
		t.Fatal("command UI should remain open when selected command is disabled")
	}
	if got.status != "Budget tab is not available in this build." {
		t.Fatalf("status = %q, want disabled reason", got.status)
	}
	if !got.statusErr {
		t.Fatal("statusErr should be true for disabled selection")
	}
}

func TestCommandOpenHotkeys(t *testing.T) {
	m := newModel()
	m.ready = true
	m.activeTab = tabManager

	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlK})
	got := next.(model)
	if !got.commandOpen || got.commandUIKind != commandUIKindPalette {
		t.Fatalf("ctrl+k should open palette, open=%v kind=%q", got.commandOpen, got.commandUIKind)
	}

	m2 := newModel()
	m2.ready = true
	m2.activeTab = tabManager
	next2, _ := m2.Update(keyMsg(":"))
	got2 := next2.(model)
	if !got2.commandOpen || got2.commandUIKind != commandUIKindColon {
		t.Fatalf(": should open colon mode, open=%v kind=%q", got2.commandOpen, got2.commandUIKind)
	}
}

func TestCommandModeEnterOnDisabledCommandDoesNotExecute(t *testing.T) {
	m := newModel()
	m.commandOpen = true
	m.commandUIKind = commandUIKindColon
	m.commandSourceScope = scopeGlobal
	m.commandCursor = 0
	m.commandMatches = []CommandMatch{
		{
			Command:        Command{ID: "nav:budget", Label: "Go to Budget"},
			Enabled:        false,
			DisabledReason: "Budget tab is not available in this build.",
		},
		{
			Command: Command{ID: "nav:settings"},
			Enabled: true,
		},
	}

	next, _ := m.updateCommandUI(keyMsg("enter"))
	got := next.(model)
	if got.activeTab == tabSettings {
		t.Fatalf("activeTab = %d, expected disabled command not to execute", got.activeTab)
	}
	if !got.commandOpen {
		t.Fatal("command UI should remain open when selected command is disabled")
	}
	if got.status != "Budget tab is not available in this build." {
		t.Fatalf("status = %q, want disabled reason", got.status)
	}
	if !got.statusErr {
		t.Fatal("statusErr should be true for disabled selection")
	}
}

func TestCommandOpenBlockedByModal(t *testing.T) {
	m := newModel()
	m.ready = true
	m.showDetail = true

	next, _ := m.Update(tea.KeyMsg{Type: tea.KeyCtrlK})
	got := next.(model)
	if got.commandOpen {
		t.Fatal("palette should not open while detail modal is active")
	}
}

func TestNextTransactionSortColumnMatchesVisualOrder(t *testing.T) {
	order := []int{
		sortByDate,
		sortByAmount,
		sortByDescription,
		sortByCategory,
		sortByDate,
	}
	cur := sortByDate
	for i := 1; i < len(order); i++ {
		cur = nextTransactionSortColumn(cur)
		if cur != order[i] {
			t.Fatalf("step %d: got sort %d want %d", i, cur, order[i])
		}
	}
}

func TestCommandCursorScrollOffsetStaysVisible(t *testing.T) {
	m := newModel()
	m.openCommandUI(commandUIKindPalette)
	m.commandMatches = make([]CommandMatch, 20)
	m.commandPageSize = 10
	m.commandCursor = 0
	m.commandScrollOffset = 0

	for i := 0; i < 12; i++ {
		next, _ := m.updateCommandUI(keyMsg("down"))
		m = next.(model)
	}

	if m.commandCursor != 12 {
		t.Fatalf("cursor=%d want 12", m.commandCursor)
	}
	if m.commandScrollOffset != 3 {
		t.Fatalf("scrollOffset=%d want 3", m.commandScrollOffset)
	}
	if m.commandCursor < m.commandScrollOffset || m.commandCursor >= m.commandScrollOffset+m.commandPageSize {
		t.Fatalf("cursor %d not visible in window [%d,%d)", m.commandCursor, m.commandScrollOffset, m.commandScrollOffset+m.commandPageSize)
	}
}

func TestCommandUIPrintableJKAreLiteralFirst(t *testing.T) {
	m := newModel()
	m.commandOpen = true
	m.commandUIKind = commandUIKindPalette
	m.commandQuery = "abc"
	m.commandCursor = 1
	m.commandSourceScope = scopeGlobal
	m.rebuildCommandMatches()

	next, _ := m.updateCommandUI(keyMsg("j"))
	got := next.(model)
	if got.commandQuery != "abcj" {
		t.Fatalf("commandQuery = %q, want %q", got.commandQuery, "abcj")
	}
}

func TestCommandUIArrowDownStillNavigates(t *testing.T) {
	m := newModel()
	m.commandOpen = true
	m.commandUIKind = commandUIKindPalette
	m.commandCursor = 0
	m.commandMatches = make([]CommandMatch, 5)
	m.commandPageSize = 10

	next, _ := m.updateCommandUI(keyMsg("down"))
	got := next.(model)
	if got.commandCursor != 1 {
		t.Fatalf("commandCursor = %d, want 1", got.commandCursor)
	}
}
