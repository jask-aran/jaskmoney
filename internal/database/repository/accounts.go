package repository

import (
	"context"
	"database/sql"
)

// AccountRepo handles accounts.
type AccountRepo struct {
	db *sql.DB
}

func NewAccountRepo(db *sql.DB) *AccountRepo {
	return &AccountRepo{db: db}
}

func (r *AccountRepo) Upsert(ctx context.Context, a Account) error {
	_, err := r.db.ExecContext(ctx, `
	INSERT INTO accounts(id, name, institution, account_type, created_at, updated_at)
	VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
	ON CONFLICT(id) DO UPDATE SET
	 name=excluded.name,
	 institution=excluded.institution,
	 account_type=excluded.account_type,
	 updated_at=CURRENT_TIMESTAMP;
	`, a.ID, a.Name, a.Institution, a.AccountType)
	return err
}

func (r *AccountRepo) List(ctx context.Context) ([]Account, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, name, institution, account_type, created_at, updated_at FROM accounts ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Account
	for rows.Next() {
		var a Account
		if err := rows.Scan(&a.ID, &a.Name, &a.Institution, &a.AccountType, &a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, a)
	}
	return out, rows.Err()
}
