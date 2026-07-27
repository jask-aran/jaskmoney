package main

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRunStartupHarnessOK(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)

	var out bytes.Buffer
	err := runStartupHarness(&out)
	if err != nil {
		t.Fatalf("runStartupHarness: %v", err)
	}
	got := out.String()
	if !strings.Contains(got, "startup_status_err=false") {
		t.Fatalf("output missing success status flag:\n%s", got)
	}
}

func TestRunStartupHarnessResetsInvalidKeybindingAction(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)

	cfgDir := filepath.Join(xdg, "jaskmoney")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		t.Fatalf("mkdir config dir: %v", err)
	}
	invalid := []byte(`version = 2

[bindings]
confirm_repeatz = ["ctrl+r"]
`)
	if err := os.WriteFile(filepath.Join(cfgDir, "keybindings.toml"), invalid, 0o644); err != nil {
		t.Fatalf("write keybindings.toml: %v", err)
	}

	var out bytes.Buffer
	err := runStartupHarness(&out)
	if err != nil {
		t.Fatalf("expected startup harness to recover by resetting defaults, got: %v\noutput:\n%s", err, out.String())
	}
	got := out.String()
	if !strings.Contains(got, "startup_status_err=false") {
		t.Fatalf("expected successful startup after reset:\n%s", got)
	}
}

func TestRunStartupHarnessRejectsLegacyActionAliasesByResetting(t *testing.T) {
	xdg := t.TempDir()
	t.Setenv("XDG_CONFIG_HOME", xdg)

	cfgDir := filepath.Join(xdg, "jaskmoney")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		t.Fatalf("mkdir config dir: %v", err)
	}
	legacyAliases := []byte(`version = 2

[bindings]
confirm_repeat = ["ctrl+r"]
cancel_any = ["ctrl+x"]
`)
	if err := os.WriteFile(filepath.Join(cfgDir, "keybindings.toml"), legacyAliases, 0o644); err != nil {
		t.Fatalf("write keybindings.toml: %v", err)
	}

	var out bytes.Buffer
	err := runStartupHarness(&out)
	if err != nil {
		t.Fatalf("expected startup to reset invalid legacy aliases, got: %v\noutput:\n%s", err, out.String())
	}
	got := out.String()
	if !strings.Contains(got, "startup_status_err=false") {
		t.Fatalf("expected startup success flag, got:\n%s", got)
	}
}

func TestRunValidationOK(t *testing.T) {
	t.Setenv("XDG_CONFIG_HOME", t.TempDir())
	if err := runValidation(); err != nil {
		t.Fatalf("runValidation: %v", err)
	}
}
