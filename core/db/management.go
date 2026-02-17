package db

import (
	"database/sql"
	"fmt"
)

func ClearAllData(db *sql.DB) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	stmts := []string{
		`DELETE FROM credit_offsets`,
		`DELETE FROM spending_target_overrides`,
		`DELETE FROM spending_targets`,
		`DELETE FROM category_budget_overrides`,
		`DELETE FROM category_budgets`,
		`DELETE FROM rules_v2`,
		`DELETE FROM filter_usage_state`,
		`DELETE FROM saved_filters`,
		`DELETE FROM transaction_tags`,
		`DELETE FROM transactions`,
		`DELETE FROM import_transaction_index`,
		`DELETE FROM imports`,
		`DELETE FROM account_selection`,
		`DELETE FROM tags`,
		`DELETE FROM categories`,
		`DELETE FROM accounts`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return fmt.Errorf("clear database: %w", err)
		}
	}
	return nil
}
