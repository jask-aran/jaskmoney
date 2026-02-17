package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestParseFormatsValid(t *testing.T) {
	data := []byte(`
[account.ANZ]
type = "credit"
sort_order = 1
is_active = true
import_prefix = "anz"
description = "ANZ Australia"
date_format = "2/01/2006"
has_header = false
delimiter = ","
date_col = 0
amount_col = 1
desc_col = 2
desc_join = true
amount_strip = ","
	`)
	formats, err := parseFormats(data)
	if err != nil {
		t.Fatalf("parseFormats: %v", err)
	}
	if len(formats) != 1 {
		t.Fatalf("expected 1 format, got %d", len(formats))
	}
	if formats[0].Name != "ANZ" {
		t.Fatalf("name = %q, want ANZ", formats[0].Name)
	}
}

func TestParseConfigSettingsDefaultsAndNormalization(t *testing.T) {
	data := []byte(`
[account.ANZ]
type = "credit"
date_format = "2/01/2006"

[settings]
rows_per_page = 100
spending_week_from = "MONDAY"
dash_timeframe = 999
dash_custom_start = "bad"
dash_custom_end = "2026-02-10"
`)
	_, settings, _, err := parseConfig(data)
	if err != nil {
		t.Fatalf("parseConfig: %v", err)
	}
	if settings.RowsPerPage != 20 {
		t.Fatalf("rows_per_page = %d, want 20", settings.RowsPerPage)
	}
	if settings.SpendingWeekFrom != "monday" {
		t.Fatalf("spending_week_from = %q, want monday", settings.SpendingWeekFrom)
	}
	if settings.DashTimeframe != dashTimeframeThisMonth {
		t.Fatalf("dash_timeframe = %d, want %d", settings.DashTimeframe, dashTimeframeThisMonth)
	}
	if settings.DashCustomStart != "" {
		t.Fatalf("dash_custom_start = %q, want empty", settings.DashCustomStart)
	}
	if settings.DashCustomEnd != "2026-02-10" {
		t.Fatalf("dash_custom_end = %q, want 2026-02-10", settings.DashCustomEnd)
	}
	if settings.CommandDefaultInterface != commandUIKindPalette {
		t.Fatalf("command_default_interface = %q, want %q", settings.CommandDefaultInterface, commandUIKindPalette)
	}
}

func TestLoadAndSaveAppSettings(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)

	formats, settings, err := loadAppConfig()
	if err != nil {
		t.Fatalf("loadAppConfig: %v", err)
	}
	if len(formats) == 0 {
		t.Fatal("expected default format")
	}
	if settings.RowsPerPage != 20 {
		t.Fatalf("default rows_per_page = %d, want 20", settings.RowsPerPage)
	}

	saved := appSettings{
		RowsPerPage:             33,
		SpendingWeekFrom:        "monday",
		DashTimeframe:           dashTimeframeCustom,
		DashCustomStart:         "2026-02-01",
		DashCustomEnd:           "2026-02-10",
		CommandDefaultInterface: commandUIKindColon,
	}
	if err := saveAppSettings(saved); err != nil {
		t.Fatalf("saveAppSettings: %v", err)
	}

	_, loaded, err := loadAppConfig()
	if err != nil {
		t.Fatalf("reload app config: %v", err)
	}
	if loaded.RowsPerPage != 33 {
		t.Fatalf("rows_per_page = %d, want 33", loaded.RowsPerPage)
	}
	if loaded.SpendingWeekFrom != "monday" {
		t.Fatalf("spending_week_from = %q, want monday", loaded.SpendingWeekFrom)
	}
	if loaded.DashTimeframe != dashTimeframeCustom {
		t.Fatalf("dash_timeframe = %d, want %d", loaded.DashTimeframe, dashTimeframeCustom)
	}
	if loaded.DashCustomStart != "2026-02-01" || loaded.DashCustomEnd != "2026-02-10" {
		t.Fatalf("custom range = %q..%q, want 2026-02-01..2026-02-10", loaded.DashCustomStart, loaded.DashCustomEnd)
	}
	if loaded.CommandDefaultInterface != commandUIKindColon {
		t.Fatalf("command_default_interface = %q, want %q", loaded.CommandDefaultInterface, commandUIKindColon)
	}

	path := filepath.Join(xdg, "jaskmoney", "config.toml")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected config.toml in XDG path: %v", err)
	}
	if _, err := time.Parse("2006-01-02", loaded.DashCustomStart); err != nil {
		t.Fatalf("expected valid saved start date: %v", err)
	}
}

func TestLoadAppConfigResetsInvalidConfigToDefaults(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)

	primary := filepath.Join(xdg, "jaskmoney", "config.toml")
	if err := os.MkdirAll(filepath.Dir(primary), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(primary, []byte("not toml"), 0o644); err != nil {
		t.Fatalf("write invalid config: %v", err)
	}

	formats, settings, saved, custom, warnings, err := loadAppConfigExtended()
	if err != nil {
		t.Fatalf("loadAppConfigExtended: %v", err)
	}
	if len(formats) == 0 {
		t.Fatal("expected regenerated default formats")
	}
	if settings.RowsPerPage != 20 {
		t.Fatalf("rows_per_page = %d, want 20", settings.RowsPerPage)
	}
	if len(saved) != 0 || len(custom) != 0 {
		t.Fatalf("expected no saved/custom modes after reset, got saved=%d custom=%d", len(saved), len(custom))
	}
	if len(warnings) == 0 {
		t.Fatal("expected warning about reset")
	}

	raw, err := os.ReadFile(primary)
	if err != nil {
		t.Fatalf("read rewritten config: %v", err)
	}
	if !strings.Contains(string(raw), "[account.") {
		t.Fatalf("rewritten config missing account table:\n%s", string(raw))
	}
}

func TestParseKeybindingsConfigActionBindings(t *testing.T) {
	defaults := NewKeyRegistry().ExportKeybindingConfig()
	data := []byte(`
version = 2

[bindings]
quick_category = ["ctrl+k"]
	`)
	items, err := parseKeybindingsConfig(data, defaults)
	if err != nil {
		t.Fatalf("parseKeybindingsConfig: %v", err)
	}

	foundQuick := false
	for _, it := range items {
		if it.Scope == scopeTransactions && it.Action == string(actionQuickCategory) {
			foundQuick = len(it.Keys) == 1 && it.Keys[0] == "ctrl+k"
		}
	}
	if !foundQuick {
		t.Fatal("expected quick_category override from action bindings")
	}
}

func TestParseKeybindingsConfigMigratesLegacyDashboardModeCycleKeys(t *testing.T) {
	defaults := NewKeyRegistry().ExportKeybindingConfig()
	data := []byte(`
version = 2

[bindings]
dashboard_mode_next = ["]"]
dashboard_mode_prev = ["["]
`)
	items, err := parseKeybindingsConfig(data, defaults)
	if err != nil {
		t.Fatalf("parseKeybindingsConfig: %v", err)
	}

	nextOK := false
	prevOK := false
	for _, it := range items {
		if it.Scope == scopeDashboardFocused && it.Action == string(actionDashboardModeNext) {
			nextOK = len(it.Keys) == 1 && it.Keys[0] == "."
		}
		if it.Scope == scopeDashboardFocused && it.Action == string(actionDashboardModePrev) {
			prevOK = len(it.Keys) == 1 && it.Keys[0] == ","
		}
	}
	if !nextOK || !prevOK {
		t.Fatalf("expected dashboard mode bindings to migrate to ,/.; next=%v prev=%v", nextOK, prevOK)
	}
}

func TestParseKeybindingsConfigRejectsLegacyAliases(t *testing.T) {
	defaults := NewKeyRegistry().ExportKeybindingConfig()
	data := []byte(`
version = 2

[bindings]
confirm_repeat = ["ctrl+r"]
	`)
	_, err := parseKeybindingsConfig(data, defaults)
	if err == nil {
		t.Fatal("expected legacy alias parse error")
	}
}

func TestParseKeybindingsConfigActionBindingsUnknownActionHasHint(t *testing.T) {
	defaults := NewKeyRegistry().ExportKeybindingConfig()
	data := []byte(`
version = 2

[bindings]
confirm_repeatz = ["ctrl+r"]
`)
	_, err := parseKeybindingsConfig(data, defaults)
	if err == nil {
		t.Fatal("expected unknown action error")
	}
	msg := err.Error()
	if !strings.Contains(msg, `unknown action "confirm_repeatz"`) {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(msg, `did you mean "confirm"`) {
		t.Fatalf("expected confirm hint, got: %v", err)
	}
}

func TestLoadKeybindingsCreatesTemplate(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)

	items, err := loadKeybindingsConfig()
	if err != nil {
		t.Fatalf("loadKeybindingsConfig: %v", err)
	}
	if len(items) == 0 {
		t.Fatal("expected default keybindings")
	}
	path := filepath.Join(xdg, "jaskmoney", "keybindings.toml")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("expected keybindings.toml to be created: %v", err)
	}
	if len(raw) == 0 {
		t.Fatal("expected non-empty keybindings.toml")
	}
}

func TestLoadKeybindingsResetsInvalidFileToDefaults(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)

	path := filepath.Join(xdg, "jaskmoney", "keybindings.toml")
	data := []byte(`
version = 1

[scopes.transactions.bind]
confirm_repeat = ["ctrl+r"]
	`)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write keybindings: %v", err)
	}

	items, err := loadKeybindingsConfig()
	if err != nil {
		t.Fatalf("loadKeybindingsConfig: %v", err)
	}
	if len(items) == 0 {
		t.Fatal("expected reset defaults")
	}

	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read keybindings.toml: %v", err)
	}
	if strings.Contains(string(raw), "scopes.") {
		t.Fatalf("expected rewritten v2 action bindings, got:\n%s", string(raw))
	}
}

func TestRenderKeybindingsTemplateActionBindings(t *testing.T) {
	bindings := []keybindingConfig{
		{Scope: "scope_a", Action: string(actionQuit), Keys: []string{"q", "ctrl+c"}},
		{Scope: "scope_a", Action: string(actionClose), Keys: []string{"esc"}},
		{Scope: "scope_b", Action: string(actionQuit), Keys: []string{"q", "ctrl+c"}},
		{Scope: "scope_b", Action: string(actionClose), Keys: []string{"esc"}},
	}
	out := renderKeybindingsTemplate(bindings)
	if !strings.Contains(out, "version = 2") {
		t.Fatalf("expected v2 keybindings template, got:\\n%s", out)
	}
	if !strings.Contains(out, "[bindings]") {
		t.Fatalf("expected bindings table, got:\\n%s", out)
	}
	if strings.Count(out, "quit =") != 1 {
		t.Fatalf("expected one quit action entry, got:\\n%s", out)
	}
}

func TestMaterializeKeybindingsRejectsManagerQuickTagConflict(t *testing.T) {
	defaults := []keybindingConfig{
		{Scope: "manager", Action: "edit", Keys: []string{"t"}},
		{Scope: "manager", Action: "quick_tag", Keys: []string{"T"}},
	}
	fileBindings := []keybindingConfig{
		{Scope: "manager", Action: "edit", Keys: []string{"t"}},
		{Scope: "manager", Action: "quick_tag", Keys: []string{"t"}},
	}

	_, _, err := materializeKeybindings(defaults, fileBindings)
	if err == nil {
		t.Fatal("expected conflict validation error")
	}
	msg := err.Error()
	if !strings.Contains(msg, `scope="manager"`) || !strings.Contains(msg, `"edit"`) || !strings.Contains(msg, `"quick_tag"`) {
		t.Fatalf("expected actionable manager conflict details, got: %v", err)
	}
}

func TestLoadKeybindingsConflictFailsExplicitlyAndPreservesFile(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)

	path := filepath.Join(xdg, "jaskmoney", "keybindings.toml")
	data := []byte(`
version = 2

[bindings]
quick_category = ["t"]
quick_tag = ["t"]
`)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write keybindings: %v", err)
	}

	_, err := loadKeybindingsConfig()
	if err == nil {
		t.Fatal("expected explicit keybinding validation failure")
	}
	if !strings.Contains(err.Error(), "resolve key conflicts") {
		t.Fatalf("expected conflict guidance, got: %v", err)
	}

	raw, readErr := os.ReadFile(path)
	if readErr != nil {
		t.Fatalf("read keybindings.toml: %v", readErr)
	}
	if string(raw) != string(data) {
		t.Fatalf("expected conflicting keybindings to be preserved for user correction; got:\n%s", string(raw))
	}
}

func TestParseConfigExtValidatesSavedFiltersAndDashboardViews(t *testing.T) {
	data := []byte(`
[account.ANZ]
type = "credit"
date_format = "2/01/2006"

[[saved_filter]]
id = "groceries"
name = "Groceries"
expr = "cat:Groceries AND amt:<0"

[[saved_filter]]
id = "broken"
name = "Broken"
expr = "cat:"

[[dashboard_view]]
pane = "net_cashflow"
name = "Renovation"
expr = "cat:Home AND amt:<0"
view_type = "line"

[[dashboard_view]]
pane = "unknown"
name = "Bad Pane"
expr = "cat:Home"
`)
	_, _, _, saved, custom, warnings, err := parseConfigExt(data)
	if err != nil {
		t.Fatalf("parseConfigExt: %v", err)
	}
	if len(saved) != 1 {
		t.Fatalf("saved filters = %d, want 1", len(saved))
	}
	if len(custom) != 1 {
		t.Fatalf("custom pane modes = %d, want 1", len(custom))
	}
	if len(warnings) < 2 {
		t.Fatalf("expected warnings for invalid entries, got %v", warnings)
	}
}

func TestSaveSavedFiltersRoundTrip(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)

	if _, _, _, _, _, err := loadAppConfigExtended(); err != nil {
		t.Fatalf("loadAppConfigExtended: %v", err)
	}

	in := []savedFilter{
		{ID: "groceries", Name: "Groceries", Expr: "cat:Groceries AND amt:<0"},
		{ID: "large_debits", Name: "Large Debits", Expr: "type:debit AND amt:<-100"},
	}
	if err := saveSavedFilters(in); err != nil {
		t.Fatalf("saveSavedFilters: %v", err)
	}

	_, _, out, _, _, err := loadAppConfigExtended()
	if err != nil {
		t.Fatalf("loadAppConfigExtended reload: %v", err)
	}
	if len(out) != len(in) {
		t.Fatalf("saved filter count = %d, want %d", len(out), len(in))
	}
	if out[0].ID != in[0].ID || out[1].ID != in[1].ID || out[0].Name != in[0].Name || out[1].Name != in[1].Name {
		t.Fatalf("saved filters mismatch: %+v", out)
	}
}

func TestSaveCustomPaneModesRoundTripDedupesPerPane(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)

	if _, _, _, _, _, err := loadAppConfigExtended(); err != nil {
		t.Fatalf("loadAppConfigExtended: %v", err)
	}

	in := []customPaneMode{
		{Pane: "net_cashflow", Name: "Renovation A", Expr: "cat:Home AND amt:<0", ViewType: ""},
		{Pane: "net_cashflow", Name: "Renovation B", Expr: "cat:Home", ViewType: "line"},
		{Pane: "composition", Name: "Dining", Expr: "cat:Dining AND amt:<0", ViewType: "pie"},
	}
	if err := saveCustomPaneModes(in); err != nil {
		t.Fatalf("saveCustomPaneModes: %v", err)
	}

	_, _, _, out, warnings, err := loadAppConfigExtended()
	if err != nil {
		t.Fatalf("loadAppConfigExtended reload: %v", err)
	}
	if len(warnings) != 0 {
		t.Fatalf("expected no warnings after save, got %v", warnings)
	}
	if len(out) != 2 {
		t.Fatalf("custom pane mode count = %d, want 2 (deduped by pane)", len(out))
	}

	net := customPaneMode{}
	comp := customPaneMode{}
	for _, mode := range out {
		switch mode.Pane {
		case "net_cashflow":
			net = mode
		case "composition":
			comp = mode
		}
	}

	if net.Pane != "net_cashflow" {
		t.Fatalf("expected net_cashflow mode after round-trip, got %+v", out)
	}
	if net.Name != "Renovation A" {
		t.Fatalf("net mode name = %q, want first entry preserved", net.Name)
	}
	if net.Expr == "" {
		t.Fatalf("net mode expr should be normalized non-empty")
	}
	if comp.Pane != "composition" || comp.Name != "Dining" {
		t.Fatalf("composition mode mismatch: %+v", comp)
	}
}

func TestSaveCustomPaneModesRejectsInvalidEntry(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)

	if _, _, _, _, _, err := loadAppConfigExtended(); err != nil {
		t.Fatalf("loadAppConfigExtended: %v", err)
	}

	err := saveCustomPaneModes([]customPaneMode{
		{Pane: "net_cashflow", Name: "Broken", Expr: "cat:", ViewType: "line"},
	})
	if err == nil {
		t.Fatal("expected saveCustomPaneModes validation error")
	}
	if !strings.Contains(err.Error(), "dashboard_view invalid") {
		t.Fatalf("expected dashboard_view invalid prefix, got %v", err)
	}

	_, _, _, custom, _, reloadErr := loadAppConfigExtended()
	if reloadErr != nil {
		t.Fatalf("reload config: %v", reloadErr)
	}
	if len(custom) != 0 {
		t.Fatalf("expected invalid save to keep persisted custom modes unchanged, got %+v", custom)
	}
}
