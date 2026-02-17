package main

import (
	"database/sql"
	"errors"
	"flag"
	"fmt"
	"log"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	_ "modernc.org/sqlite"

	"jaskmoney-v2/app"
	"jaskmoney-v2/core"
	"jaskmoney-v2/core/db"
)

func main() {
	manage := flag.String("manage", "", "run management action and exit (import|clear-db|seed)")
	flag.Parse()

	database, err := sql.Open("sqlite", "file:transactions.db?cache=shared")
	if err != nil {
		log.Fatal(err)
	}
	defer database.Close()

	if err := db.InitSchema(database); err != nil {
		log.Fatal(err)
	}

	defaultBindings := core.DefaultKeyBindings()
	configBundle, err := db.LoadConfigBundle(".", db.LoadConfigDefaults{
		AppJumpKey:          core.DefaultJumpKey(defaultBindings),
		KeybindingsByAction: core.DefaultKeybindingsByAction(defaultBindings),
	})
	if err != nil {
		log.Fatal(err)
	}
	if err := app.EnsureTaxonomyConfig("."); err != nil {
		log.Fatal(err)
	}

	keyReg := core.NewKeyRegistry(core.ApplyActionKeybindings(defaultBindings, configBundle.Keybindings.Bindings))
	cmdReg := core.NewCommandRegistry(nil)

	model := core.NewModel(app.Tabs(), keyReg, cmdReg, database, core.AppData{})
	app.ConfigureModel(&model)
	if strings.TrimSpace(*manage) != "" {
		if err := runManagementAction(*manage, &model); err != nil {
			log.Fatal(err)
		}
		return
	}

	p := tea.NewProgram(model, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		log.Fatal(err)
	}
}

func runManagementAction(action string, model *core.Model) error {
	action = strings.ToLower(strings.TrimSpace(action))
	commandID := map[string]string{
		"import":   "manage-import",
		"clear-db": "manage-clear-db",
		"seed":     "manage-seed-test-data",
	}[action]
	if commandID == "" {
		return fmt.Errorf("unknown --manage action %q (supported: import, clear-db, seed)", action)
	}
	cmd := model.CommandRegistry().Execute(commandID, model)
	if cmd == nil {
		return nil
	}
	msg := cmd()
	status, ok := msg.(core.StatusMsg)
	if !ok {
		return nil
	}
	if status.IsErr {
		return errors.New(status.Text)
	}
	log.Print(status.Text)
	return nil
}
