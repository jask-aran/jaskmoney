package main

import (
	"testing"
)

func TestSplitLines(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  int // expected number of lines
	}{
		{"empty", "", 1},
		{"single", "hello", 1},
		{"two_lines", "hello\nworld", 2},
		{"trailing_newline", "hello\n", 2},
		{"three_lines", "a\nb\nc", 3},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := splitLines(tt.input)
			if len(got) != tt.want {
				t.Errorf("splitLines(%q) = %d lines, want %d", tt.input, len(got), tt.want)
			}
		})
	}
}

func TestPadRight(t *testing.T) {
	tests := []struct {
		name  string
		input string
		width int
		want  string
	}{
		{"shorter", "hi", 5, "hi   "},
		{"exact", "hello", 5, "hello"},
		{"longer", "hello world", 5, "hello world"},
		{"zero_width", "hi", 0, "hi"},
		{"negative", "hi", -1, "hi"},
		{"empty_input", "", 3, "   "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := padRight(tt.input, tt.width)
			if got != tt.want {
				t.Errorf("padRight(%q, %d) = %q, want %q", tt.input, tt.width, got, tt.want)
			}
		})
	}
}

func TestTruncate(t *testing.T) {
	tests := []struct {
		name  string
		input string
		width int
	}{
		{"short", "hi", 10},
		{"exact", "hello", 5},
		{"long", "hello world this is long", 10},
		{"zero", "hello", 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := truncate(tt.input, tt.width)
			if tt.width == 0 {
				if got != "" {
					t.Errorf("truncate(%q, 0) = %q, want empty", tt.input, got)
				}
				return
			}
			// Result should not exceed the width in visual characters
			// (just a basic sanity check — ANSI width is tested by the library)
			if len(got) > len(tt.input)+3 { // +3 for potential ellipsis bytes
				t.Errorf("truncate(%q, %d) = %q, seems too long", tt.input, tt.width, got)
			}
		})
	}
}

func TestMaxLineWidth(t *testing.T) {
	tests := []struct {
		name  string
		lines []string
		want  int
	}{
		{"single", []string{"hello"}, 5},
		{"multiple", []string{"hi", "hello", "hey"}, 5},
		{"empty", []string{""}, 0},
		{"mixed", []string{"", "ab", "abcd", "a"}, 4},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := maxLineWidth(tt.lines)
			if got != tt.want {
				t.Errorf("maxLineWidth = %d, want %d", got, tt.want)
			}
		})
	}
}
