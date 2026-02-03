package database

import (
	"database/sql"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/sqlite3"
	_ "github.com/golang-migrate/migrate/v4/source/file"
)

// RunMigrations applies all up migrations found at path.
func RunMigrations(dbPath, migrationsPath string) error {
	dsn := fmt.Sprintf("file:%s?_foreign_keys=on", dbPath)

	m, err := migrate.New(
		fmt.Sprintf("file://%s", migrationsPath),
		dsn,
	)
	if err != nil {
		return err
	}
	defer m.Close()

	err = m.Up()
	if err == migrate.ErrNoChange {
		return nil
	}
	return err
}

// RunMigrationsWithDB allows reuse of an existing *sql.DB.
func RunMigrationsWithDB(db *sql.DB, migrationsPath string) error {
	driver, err := sqlite3.WithInstance(db, &sqlite3.Config{})
	if err != nil {
		return err
	}
	m, err := migrate.NewWithDatabaseInstance(
		fmt.Sprintf("file://%s", migrationsPath),
		"sqlite3",
		driver,
	)
	if err != nil {
		return err
	}
	defer m.Close()

	err = m.Up()
	if err == migrate.ErrNoChange {
		return nil
	}
	return err
}
