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
[[format]]
name = "ANZ"
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
[[format]]
name = "ANZ"
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
		RowsPerPage:      33,
		SpendingWeekFrom: "monday",
		DashTimeframe:    dashTimeframeCustom,
		DashCustomStart:  "2026-02-01",
		DashCustomEnd:    "2026-02-10",
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

	path := filepath.Join(xdg, "jaskmoney", "config.toml")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected config.toml in XDG path: %v", err)
	}
	if _, err := time.Parse("2006-01-02", loaded.DashCustomStart); err != nil {
		t.Fatalf("expected valid saved start date: %v", err)
	}
}

func TestLoadAppConfigMigratesLegacyFormatsToml(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)

	legacy := filepath.Join(xdg, "jaskmoney", "formats.toml")
	data := []byte(`
[[format]]
name = "ANZ"
date_format = "2/01/2006"
`)
	if err := os.MkdirAll(filepath.Dir(legacy), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(legacy, data, 0o644); err != nil {
		t.Fatalf("write legacy config: %v", err)
	}

	_, _, err := loadAppConfig()
	if err != nil {
		t.Fatalf("loadAppConfig: %v", err)
	}

	primary := filepath.Join(xdg, "jaskmoney", "config.toml")
	if _, err := os.Stat(primary); err != nil {
		t.Fatalf("expected migrated config.toml: %v", err)
	}
}

func TestLoadAppConfigMigratesAppLocalConfig(t *testing.T) {
	xdg := t.TempDir()
	app := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)
	t.Chdir(app)

	local := filepath.Join(app, "config.toml")
	data := []byte(`
[[format]]
name = "ANZ"
date_format = "2/01/2006"
`)
	if err := os.WriteFile(local, data, 0o644); err != nil {
		t.Fatalf("write local config: %v", err)
	}

	_, _, err := loadAppConfig()
	if err != nil {
		t.Fatalf("loadAppConfig: %v", err)
	}

	primary := filepath.Join(xdg, "jaskmoney", "config.toml")
	if _, err := os.Stat(primary); err != nil {
		t.Fatalf("expected migrated XDG config.toml: %v", err)
	}
}

func TestParseKeybindingsConfigActionBindings(t *testing.T) {
	defaults := NewKeyRegistry().ExportKeybindingConfig()
	data := []byte(`
version = 2

[bindings]
quick_category = ["ctrl+k"]
close = ["esc"]
`)
	items, migrated, err := parseKeybindingsConfig(data, defaults)
	if err != nil {
		t.Fatalf("parseKeybindingsConfig: %v", err)
	}
	if migrated {
		t.Fatal("did not expect v2 keybindings to be marked migrated")
	}

	foundQuick := false
	foundCloseInDetail := false
	foundCloseInFile := false
	for _, it := range items {
		if it.Scope == scopeTransactions && it.Action == string(actionQuickCategory) {
			foundQuick = len(it.Keys) == 1 && it.Keys[0] == "ctrl+k"
		}
		if it.Scope == scopeDetailModal && it.Action == string(actionClose) {
			foundCloseInDetail = len(it.Keys) == 1 && it.Keys[0] == "esc"
		}
		if it.Scope == scopeFilePicker && it.Action == string(actionClose) {
			foundCloseInFile = len(it.Keys) == 1 && it.Keys[0] == "esc"
		}
	}
	if !foundQuick {
		t.Fatal("expected quick_category override from action bindings")
	}
	if !foundCloseInDetail || !foundCloseInFile {
		t.Fatal("expected close override to apply to every scope exposing close")
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

func TestLoadKeybindingsMigratesLegacyFromConfig(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)

	cfgPath := filepath.Join(xdg, "jaskmoney", "config.toml")
	data := []byte(`
[[format]]
name = "ANZ"
date_format = "2/01/2006"

[[shortcut_override]]
scope = "transactions"
action = "quick_category"
keys = ["ctrl+k"]
`)
	if err := os.MkdirAll(filepath.Dir(cfgPath), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(cfgPath, data, 0o644); err != nil {
		t.Fatalf("write config: %v", err)
	}

	items, err := loadKeybindingsConfig()
	if err != nil {
		t.Fatalf("loadKeybindingsConfig: %v", err)
	}
	found := false
	for _, it := range items {
		if it.Scope == scopeTransactions && it.Action == string(actionQuickCategory) && len(it.Keys) > 0 && it.Keys[0] == "ctrl+k" {
			found = true
			break
		}
	}
	if !found {
		t.Fatal("expected migrated quick_category override")
	}

	path := filepath.Join(xdg, "jaskmoney", "keybindings.toml")
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected keybindings.toml to be created: %v", err)
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

func TestMaterializeKeybindingsMigratesManagerQuickTagConflict(t *testing.T) {
	defaults := []keybindingConfig{
		{Scope: "manager", Action: "edit", Keys: []string{"t"}},
		{Scope: "manager", Action: "quick_tag", Keys: []string{"T"}},
	}
	fileBindings := []keybindingConfig{
		{Scope: "manager", Action: "edit", Keys: []string{"t"}},
		{Scope: "manager", Action: "quick_tag", Keys: []string{"t"}},
	}

	out, changed, err := materializeKeybindings(defaults, fileBindings)
	if err != nil {
		t.Fatalf("materializeKeybindings: %v", err)
	}
	if !changed {
		t.Fatal("expected changed=true after migration")
	}

	var quick []string
	for _, b := range out {
		if b.Scope == "manager" && b.Action == "quick_tag" {
			quick = b.Keys
			break
		}
	}
	if len(quick) == 0 {
		t.Fatal("expected manager/quick_tag binding")
	}
	if normalizeKeyName(quick[0]) == "t" {
		t.Fatalf("expected quick_tag not to conflict with edit key 't', got %+v", quick)
	}
}
