package main

import (
	"flag"
	"fmt"
	"os"

	tea "github.com/charmbracelet/bubbletea"
)

func main() {
	validate := flag.Bool("validate", false, "run non-TUI validation")
	flag.Parse()
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
