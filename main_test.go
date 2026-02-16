package main

import (
	"testing"

	"jaskmoney-v2/core"
)

func TestApplyActionKeybindings(t *testing.T) {
	defaults := core.DefaultKeyBindings()
	overrides := map[string][]string{
		"quit": {"ctrl+c"},
	}

	got := core.ApplyActionKeybindings(defaults, overrides)

	if len(got) != len(defaults) {
		t.Fatalf("len(got) = %d, want %d", len(got), len(defaults))
	}
	if len(got[0].Keys) != 1 || got[0].Keys[0] != "ctrl+c" {
		t.Fatalf("quit keys = %#v, want [ctrl+c]", got[0].Keys)
	}
	if len(got[1].Keys) != 1 || got[1].Keys[0] != "v" {
		t.Fatalf("jump keys = %#v, want [v]", got[1].Keys)
	}
}
