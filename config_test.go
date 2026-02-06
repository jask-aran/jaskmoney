package main

import (
	"os"
	"path/filepath"
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
	f := formats[0]
	if f.Name != "ANZ" {
		t.Errorf("name = %q, want %q", f.Name, "ANZ")
	}
	if f.DateFormat != "2/01/2006" {
		t.Errorf("date_format = %q, want %q", f.DateFormat, "2/01/2006")
	}
	if f.HasHeader {
		t.Error("has_header should be false")
	}
	if !f.DescJoin {
		t.Error("desc_join should be true")
	}
	if f.DateCol != 0 {
		t.Errorf("date_col = %d, want 0", f.DateCol)
	}
	if f.AmountCol != 1 {
		t.Errorf("amount_col = %d, want 1", f.AmountCol)
	}
	if f.DescCol != 2 {
		t.Errorf("desc_col = %d, want 2", f.DescCol)
	}
}

func TestParseFormatsMultiple(t *testing.T) {
	data := []byte(`
[[format]]
name = "ANZ"
date_format = "2/01/2006"

[[format]]
name = "CBA"
date_format = "02/01/2006"
has_header = true
`)
	formats, err := parseFormats(data)
	if err != nil {
		t.Fatalf("parseFormats: %v", err)
	}
	if len(formats) != 2 {
		t.Fatalf("expected 2 formats, got %d", len(formats))
	}
	if formats[0].Name != "ANZ" {
		t.Errorf("formats[0].name = %q, want %q", formats[0].Name, "ANZ")
	}
	if formats[1].Name != "CBA" {
		t.Errorf("formats[1].name = %q, want %q", formats[1].Name, "CBA")
	}
	if !formats[1].HasHeader {
		t.Error("CBA should have has_header = true")
	}
}

func TestParseFormatsNoName(t *testing.T) {
	data := []byte(`
[[format]]
date_format = "2/01/2006"
`)
	_, err := parseFormats(data)
	if err == nil {
		t.Error("expected error for missing name")
	}
}

func TestParseFormatsNoDateFormat(t *testing.T) {
	data := []byte(`
[[format]]
name = "Bad"
`)
	_, err := parseFormats(data)
	if err == nil {
		t.Error("expected error for missing date_format")
	}
}

func TestParseFormatsEmpty(t *testing.T) {
	data := []byte(``)
	_, err := parseFormats(data)
	if err == nil {
		t.Error("expected error for empty config")
	}
}

func TestParseFormatsMalformedTOML(t *testing.T) {
	data := []byte(`this is not valid toml [[[`)
	_, err := parseFormats(data)
	if err == nil {
		t.Error("expected error for malformed TOML")
	}
}

func TestDefaultFormats(t *testing.T) {
	formats := defaultFormats()
	if len(formats) != 1 {
		t.Fatalf("expected 1 default format, got %d", len(formats))
	}
	if formats[0].Name != "ANZ" {
		t.Errorf("default format name = %q, want %q", formats[0].Name, "ANZ")
	}
}

func TestParseDefaultConfigTOML(t *testing.T) {
	formats, err := parseFormats([]byte(defaultConfigTOML))
	if err != nil {
		t.Fatalf("parsing default config: %v", err)
	}
	if len(formats) != 1 {
		t.Fatalf("expected 1 format in default config, got %d", len(formats))
	}
	if formats[0].Name != "ANZ" {
		t.Errorf("default format = %q, want %q", formats[0].Name, "ANZ")
	}
}

func TestFindFormat(t *testing.T) {
	formats := []csvFormat{
		{Name: "ANZ", DateFormat: "2/01/2006"},
		{Name: "CBA", DateFormat: "02/01/2006"},
	}
	f := findFormat(formats, "CBA")
	if f == nil {
		t.Fatal("expected to find CBA")
	}
	if f.DateFormat != "02/01/2006" {
		t.Errorf("date_format = %q, want %q", f.DateFormat, "02/01/2006")
	}

	f2 := findFormat(formats, "NONEXISTENT")
	if f2 != nil {
		t.Error("expected nil for nonexistent format")
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
	formats, settings, err := parseConfig(data)
	if err != nil {
		t.Fatalf("parseConfig: %v", err)
	}
	if len(formats) != 1 {
		t.Fatalf("formats count = %d, want 1", len(formats))
	}
	if settings.RowsPerPage != 20 {
		t.Fatalf("rows_per_page = %d, want default 20 (normalized)", settings.RowsPerPage)
	}
	if settings.SpendingWeekFrom != "monday" {
		t.Fatalf("spending_week_from = %q, want %q", settings.SpendingWeekFrom, "monday")
	}
	if settings.DashTimeframe != dashTimeframeThisMonth {
		t.Fatalf("dash_timeframe = %d, want default %d", settings.DashTimeframe, dashTimeframeThisMonth)
	}
	if settings.DashCustomStart != "" {
		t.Fatalf("dash_custom_start = %q, want empty after normalization", settings.DashCustomStart)
	}
	if settings.DashCustomEnd != "2026-02-10" {
		t.Fatalf("dash_custom_end = %q, want %q", settings.DashCustomEnd, "2026-02-10")
	}
}

func TestLoadAndSaveAppSettings(t *testing.T) {
	tmp := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", tmp)

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

	path := filepath.Join(tmp, "jaskmoney", "formats.toml")
	if _, err := time.Parse("2006-01-02", loaded.DashCustomStart); err != nil {
		t.Fatalf("expected valid saved start date: %v", err)
	}
	if _, err := time.Parse("2006-01-02", loaded.DashCustomEnd); err != nil {
		t.Fatalf("expected valid saved end date: %v", err)
	}
	if _, err := parseFormatsMustRead(path); err != nil {
		t.Fatalf("formats should remain parseable after saving settings: %v", err)
	}
}

func parseFormatsMustRead(path string) ([]csvFormat, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	return parseFormats(data)
}
