package app

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadTaxonomyConfigSeedsDefaultsWhenMissing(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, "config")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		t.Fatal(err)
	}
	minimal := "version = 1\n\n[app]\njump_key = \"v\"\n"
	if err := os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte(minimal), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg, err := loadTaxonomyConfig(root)
	if err != nil {
		t.Fatalf("loadTaxonomyConfig() error = %v", err)
	}
	if len(cfg.Categories) == 0 {
		t.Fatalf("expected seeded categories")
	}
	if len(cfg.Tags) == 0 {
		t.Fatalf("expected seeded tags")
	}
	if !hasMandatoryIgnoreTag(cfg.Tags) {
		t.Fatalf("expected mandatory %q tag", mandatoryIgnoreTagName)
	}

	raw, err := os.ReadFile(filepath.Join(cfgDir, "config.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "[category]") {
		t.Fatalf("expected category section to be materialized")
	}
	if !strings.Contains(string(raw), "[tag]") {
		t.Fatalf("expected tag section to be materialized")
	}
}

func TestSaveTaxonomyConfigRoundTrip(t *testing.T) {
	root := t.TempDir()
	cfg := taxonomyConfig{
		AppJumpKey: "v",
		Categories: []taxonomyCategory{
			{Key: "one", Name: "One", Color: "#111111", SortOrder: 1, IsDefault: false},
			{Key: "uncategorised", Name: "Uncategorised", Color: "#7f849c", SortOrder: 2, IsDefault: true},
		},
		Tags: []taxonomyTag{
			{Key: "ignore", Name: mandatoryIgnoreTagName, Color: "#f38ba8", SortOrder: 1, ScopeCategory: ""},
			{Key: "ops", Name: "Ops", Color: "#a6e3a1", SortOrder: 2, ScopeCategory: "one"},
		},
	}
	if err := saveTaxonomyConfig(root, cfg); err != nil {
		t.Fatalf("saveTaxonomyConfig() error = %v", err)
	}
	out, err := loadTaxonomyConfig(root)
	if err != nil {
		t.Fatalf("loadTaxonomyConfig() error = %v", err)
	}
	if len(out.Categories) != 2 {
		t.Fatalf("categories count = %d, want 2", len(out.Categories))
	}
	if len(out.Tags) != 2 {
		t.Fatalf("tags count = %d, want 2", len(out.Tags))
	}
	if out.Tags[1].ScopeCategory != "one" {
		t.Fatalf("tag scope = %q, want %q", out.Tags[1].ScopeCategory, "one")
	}
}
