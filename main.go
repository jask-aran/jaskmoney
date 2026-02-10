package main

import (
	"flag"
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
)

func main() {
	validate := flag.Bool("validate", false, "run non-TUI validation")
	startupCheck := flag.Bool("startup-check", false, "run startup diagnostics harness (prints startup status)")
	flag.Parse()
	if *validate && *startupCheck {
		fmt.Fprintln(os.Stderr, "cannot use -validate and -startup-check together")
		os.Exit(2)
	}
	if *startupCheck {
		if err := runStartupHarness(os.Stdout); err != nil {
			os.Exit(1)
		}
		return
	}
	if *validate {
		if err := runValidation(); err != nil {
			fmt.Fprintln(os.Stderr, "validation failed:", err)
			os.Exit(1)
		}
		fmt.Println("validation ok")
		return
	}
	p := tea.NewProgram(newModel(), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Println("error:", err)
		os.Exit(1)
	}
}
