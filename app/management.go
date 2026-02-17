package app

import (
	"database/sql"
	"fmt"

	"jaskmoney-v2/core"
	"jaskmoney-v2/core/db"
)

func ImportFromConfig(database *sql.DB) (db.ImportSummary, error) {
	if database == nil {
		return db.ImportSummary{}, fmt.Errorf("database is nil")
	}
	defaultBindings := core.DefaultKeyBindings()
	configBundle, err := db.LoadConfigBundle(".", db.LoadConfigDefaults{
		AppJumpKey:          core.DefaultJumpKey(defaultBindings),
		KeybindingsByAction: core.DefaultKeybindingsByAction(defaultBindings),
	})
	if err != nil {
		return db.ImportSummary{}, err
	}
	return db.ImportFromDir(database, "imports", configBundle.Accounts)
}

func ClearDatabase(database *sql.DB) error {
	return db.ClearAllData(database)
}
