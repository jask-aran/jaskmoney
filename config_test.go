package main

import (
	"testing"
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
