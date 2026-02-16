package db

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func testLoadDefaults() LoadConfigDefaults {
	return LoadConfigDefaults{
		AppJumpKey: "v",
		KeybindingsByAction: map[string][]string{
			"quit":                 {"q"},
			"jump":                 {"v"},
			"open-command-palette": {"ctrl+k"},
		},
	}
}

func TestLoadConfigBundleCreatesDefaultFiles(t *testing.T) {
	root := t.TempDir()

	bundle, err := LoadConfigBundle(root, testLoadDefaults())
	if err != nil {
		t.Fatalf("LoadConfigBundle() error = %v", err)
	}

	if bundle.Config.App.JumpKey != "v" {
		t.Fatalf("jump_key = %q, want %q", bundle.Config.App.JumpKey, "v")
	}
	if len(bundle.Accounts.Account) != 0 {
		t.Fatalf("accounts count = %d, want 0", len(bundle.Accounts.Account))
	}
	if len(bundle.Keybindings.Bindings) != 3 {
		t.Fatalf("keybindings count = %d, want 3", len(bundle.Keybindings.Bindings))
	}

	paths := []string{
		filepath.Join(root, "config", "config.toml"),
		filepath.Join(root, "config", "accounts.toml"),
		filepath.Join(root, "config", "keybindings.toml"),
	}
	for _, path := range paths {
		if _, err := os.Stat(path); err != nil {
			t.Fatalf("expected %s to exist: %v", path, err)
		}
	}

	raw, err := os.ReadFile(filepath.Join(root, "config", "keybindings.toml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), "open-command-palette") {
		t.Fatalf("expected seeded defaults in keybindings.toml")
	}
}

func TestLoadConfigBundleRejectsInvalidKeybindings(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, "config")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte("version = 1\n\n[app]\njump_key = \"v\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cfgDir, "accounts.toml"), []byte(defaultAccountsTOML), 0o644); err != nil {
		t.Fatal(err)
	}
	invalid := "version = 1\n\n[bindings]\nquit = []\n"
	if err := os.WriteFile(filepath.Join(cfgDir, "keybindings.toml"), []byte(invalid), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := LoadConfigBundle(root, testLoadDefaults()); err == nil {
		t.Fatalf("expected invalid keybindings error")
	}
}

func TestLoadConfigBundleReadsKeybindingOverrides(t *testing.T) {
	root := t.TempDir()
	cfgDir := filepath.Join(root, "config")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		t.Fatal(err)
	}

	if err := os.WriteFile(filepath.Join(cfgDir, "config.toml"), []byte("version = 1\n\n[app]\njump_key = \"v\"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(cfgDir, "accounts.toml"), []byte(defaultAccountsTOML), 0o644); err != nil {
		t.Fatal(err)
	}
	kb := "version = 1\n\n[bindings]\nquit = [\"ctrl+c\"]\nopen-command-palette = [\"ctrl+p\"]\n"
	if err := os.WriteFile(filepath.Join(cfgDir, "keybindings.toml"), []byte(kb), 0o644); err != nil {
		t.Fatal(err)
	}

	bundle, err := LoadConfigBundle(root, testLoadDefaults())
	if err != nil {
		t.Fatalf("LoadConfigBundle() error = %v", err)
	}

	if got := bundle.Keybindings.Bindings["quit"]; len(got) != 1 || got[0] != "ctrl+c" {
		t.Fatalf("quit override = %#v, want [ctrl+c]", got)
	}
	if got := bundle.Keybindings.Bindings["open-command-palette"]; len(got) != 1 || got[0] != "ctrl+p" {
		t.Fatalf("open-command-palette override = %#v, want [ctrl+p]", got)
	}
	if got := bundle.Keybindings.Bindings["jump"]; len(got) != 1 || got[0] != "v" {
		t.Fatalf("jump key should be seeded from defaults, got %#v", got)
	}
}
