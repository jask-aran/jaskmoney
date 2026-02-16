package main

import (
	"database/sql"
	"log"

	tea "github.com/charmbracelet/bubbletea"
	_ "modernc.org/sqlite"

	"jaskmoney-v2/app"
	"jaskmoney-v2/core"
	"jaskmoney-v2/core/db"
)

func main() {
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

	importSummary, err := db.ImportFromDir(database, "imports", configBundle.Accounts)
	if err != nil {
		log.Fatal(err)
	}
	log.Printf(
		"imports: seen=%d imported=%d skipped=%d rows=%d dupes=%d",
		importSummary.FilesSeen,
		importSummary.FilesImported,
		importSummary.FilesSkipped,
		importSummary.RowsImported,
		importSummary.RowsDuplicates,
	)

	keyReg := core.NewKeyRegistry(core.ApplyActionKeybindings(defaultBindings, configBundle.Keybindings.Bindings))
	cmdReg := core.NewCommandRegistry(nil)

	model := core.NewModel(app.Tabs(), keyReg, cmdReg, database, core.AppData{})
	app.ConfigureModel(&model)

	p := tea.NewProgram(model, tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		log.Fatal(err)
	}
}
