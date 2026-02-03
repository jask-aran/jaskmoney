package repository

import (
	"context"
	"database/sql"
)

// CategoryRepo handles categories.
type CategoryRepo struct {
	db *sql.DB
}

func NewCategoryRepo(db *sql.DB) *CategoryRepo {
	return &CategoryRepo{db: db}
}

func (r *CategoryRepo) Upsert(ctx context.Context, c Category) error {
	_, err := r.db.ExecContext(ctx, `
	INSERT INTO categories(id, parent_id, name, icon, sort_order)
	VALUES (?, ?, ?, ?, ?)
	ON CONFLICT(id) DO UPDATE SET
	 parent_id=excluded.parent_id,
	 name=excluded.name,
	 icon=excluded.icon,
	 sort_order=excluded.sort_order;
	`, c.ID, c.ParentID, c.Name, c.Icon, c.SortOrder)
	return err
}

func (r *CategoryRepo) List(ctx context.Context) ([]Category, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, parent_id, name, icon, sort_order FROM categories ORDER BY sort_order, name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Category
	for rows.Next() {
		var c Category
		if err := rows.Scan(&c.ID, &c.ParentID, &c.Name, &c.Icon, &c.SortOrder); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}
