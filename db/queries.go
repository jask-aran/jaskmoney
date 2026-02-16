package db

import "database/sql"

type Account struct {
	ID     int
	Name   string
	Type   string
	Prefix string
	Active bool
}

type Transaction struct {
	ID          int
	AccountID   int
	DateISO     string
	Amount      float64
	Description string
	CategoryID  sql.NullInt64
	Notes       sql.NullString
}

type Category struct {
	ID    int
	Name  string
	Color string
}

type Tag struct {
	ID      int
	Name    string
	ScopeID sql.NullInt64
}

func GetTransactions(db *sql.DB) ([]Transaction, error) {
	rows, err := db.Query(`SELECT id, account_id, date_iso, amount, description, category_id, notes FROM transactions ORDER BY date_iso DESC, id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Transaction
	for rows.Next() {
		var t Transaction
		if err := rows.Scan(&t.ID, &t.AccountID, &t.DateISO, &t.Amount, &t.Description, &t.CategoryID, &t.Notes); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func GetTransactionsByAccount(db *sql.DB, accountID int) ([]Transaction, error) {
	rows, err := db.Query(`SELECT id, account_id, date_iso, amount, description, category_id, notes FROM transactions WHERE account_id = ? ORDER BY date_iso DESC, id DESC`, accountID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Transaction
	for rows.Next() {
		var t Transaction
		if err := rows.Scan(&t.ID, &t.AccountID, &t.DateISO, &t.Amount, &t.Description, &t.CategoryID, &t.Notes); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func GetAccounts(db *sql.DB) ([]Account, error) {
	rows, err := db.Query(`SELECT id, name, type, COALESCE(prefix, ''), active FROM accounts ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Account
	for rows.Next() {
		var a Account
		var active int
		if err := rows.Scan(&a.ID, &a.Name, &a.Type, &a.Prefix, &active); err != nil {
			return nil, err
		}
		a.Active = active == 1
		out = append(out, a)
	}
	return out, rows.Err()
}

func GetCategories(db *sql.DB) ([]Category, error) {
	rows, err := db.Query(`SELECT id, name, color FROM categories ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Category
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.ID, &c.Name, &c.Color); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func GetTags(db *sql.DB) ([]Tag, error) {
	rows, err := db.Query(`SELECT id, name, scope_id FROM tags ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Tag
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name, &t.ScopeID); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
