package app

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"

	"jaskmoney-v2/core"
	"jaskmoney-v2/core/screens"
)

func newTransactionDetailModal(dbConn *sql.DB, transactionID int) core.Screen {
	if transactionID <= 0 {
		return screens.NewEditorScreen(
			"Transaction Detail",
			"screen:txn-detail",
			[]screens.EditorField{{Key: "notes", Label: "Notes", Value: ""}},
			func(values map[string]string) tea.Msg {
				_ = values
				return core.StatusMsg{Text: "TXN_DETAIL_INVALID_ID: invalid transaction id", IsErr: true}
			},
		)
	}
	if dbConn == nil {
		return screens.NewEditorScreen(
			"Transaction Detail",
			"screen:txn-detail",
			[]screens.EditorField{{Key: "notes", Label: "Notes", Value: ""}},
			func(values map[string]string) tea.Msg {
				_ = values
				return core.StatusMsg{Text: "TXN_DETAIL_DB_NIL: database not ready", IsErr: true}
			},
		)
	}

	type row struct {
		dateISO     string
		amount      float64
		description string
		categoryID  sql.NullInt64
		notes       string
	}
	var current row
	if err := dbConn.QueryRow(`
		SELECT date_iso, amount, description, category_id, COALESCE(notes, '')
		FROM transactions
		WHERE id = ?
	`, transactionID).Scan(&current.dateISO, &current.amount, &current.description, &current.categoryID, &current.notes); err != nil {
		return screens.NewEditorScreen(
			"Transaction Detail",
			"screen:txn-detail",
			[]screens.EditorField{{Key: "notes", Label: "Notes", Value: ""}},
			func(values map[string]string) tea.Msg {
				_ = values
				return core.StatusMsg{Text: "TXN_DETAIL_LOAD_FAILED: " + err.Error(), IsErr: true}
			},
		)
	}

	categoryRaw := ""
	if current.categoryID.Valid {
		categoryRaw = strconv.Itoa(int(current.categoryID.Int64))
	}
	title := fmt.Sprintf("Txn #%d %s %.2f", transactionID, current.dateISO, current.amount)
	return screens.NewEditorScreen(
		title,
		"screen:txn-detail",
		[]screens.EditorField{
			{Key: "category_id", Label: "Category ID (blank clears)", Value: categoryRaw},
			{Key: "notes", Label: "Notes", Value: current.notes},
		},
		func(values map[string]string) tea.Msg {
			dbNow := activeDB()
			if dbNow == nil {
				dbNow = dbConn
			}
			if dbNow == nil {
				return core.StatusMsg{Text: "TXN_DETAIL_DB_NIL: database not ready", IsErr: true}
			}
			notes := values["notes"]
			rawCategory := strings.TrimSpace(values["category_id"])
			var categoryID any
			if rawCategory == "" {
				categoryID = nil
			} else {
				parsed, parseErr := strconv.Atoi(rawCategory)
				if parseErr != nil {
					return core.StatusMsg{Text: "TXN_DETAIL_CATEGORY_INVALID: category id must be numeric", IsErr: true}
				}
				categoryID = parsed
			}
			if _, err := dbNow.Exec(`UPDATE transactions SET category_id = ?, notes = ? WHERE id = ?`, categoryID, notes, transactionID); err != nil {
				return core.StatusMsg{Text: "TXN_DETAIL_SAVE_FAILED: " + err.Error(), IsErr: true}
			}
			return core.StatusMsg{Text: "Transaction updated.", Code: "TXN_DETAIL_SAVED"}
		},
	)
}
