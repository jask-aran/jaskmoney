package app

import "database/sql"

var runtimeDB *sql.DB

func bindRuntimeDB(db *sql.DB) {
	runtimeDB = db
}

func activeDB() *sql.DB {
	return runtimeDB
}
