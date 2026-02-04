package service

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/jask/jaskmoney/internal/database"
)

// MaintenanceService houses destructive/ops actions surfaced through the TUI.
type MaintenanceService struct {
	DB *sql.DB
}

// Reset wipes all user data. It keeps the schema intact so the app can continue running.
func (s *MaintenanceService) Reset(ctx context.Context) error {
	if s.DB == nil {
		return fmt.Errorf("maintenance: db not configured")
	}
	if err := database.WithTx(s.DB, func(tx *sql.Tx) error {
		tables := []string{
			"pending_reconciliations",
			"transaction_tags",
			"merchant_rules",
			"transactions",
			"tags",
			"categories",
			"accounts",
		}
		for _, t := range tables {
			if _, err := tx.ExecContext(ctx, "DELETE FROM "+t); err != nil {
				return fmt.Errorf("reset table %s: %w", t, err)
			}
		}
		return nil
	}); err != nil {
		return err
	}
	_, _ = s.DB.ExecContext(ctx, "VACUUM")
	return nil
}
