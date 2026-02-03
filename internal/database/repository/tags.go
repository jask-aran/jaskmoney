package repository

import (
	"context"
	"database/sql"
)

// TagRepo handles tags.
type TagRepo struct {
	db *sql.DB
}

func NewTagRepo(db *sql.DB) *TagRepo { return &TagRepo{db: db} }

func (r *TagRepo) Upsert(ctx context.Context, t Tag) error {
	_, err := r.db.ExecContext(ctx, `
	INSERT INTO tags(id, name) VALUES (?, ?)
	ON CONFLICT(id) DO UPDATE SET name=excluded.name;
	`, t.ID, t.Name)
	return err
}

func (r *TagRepo) ByName(ctx context.Context, name string) (*Tag, error) {
	row := r.db.QueryRowContext(ctx, `SELECT id, name FROM tags WHERE name = ?`, name)
	var t Tag
	if err := row.Scan(&t.ID, &t.Name); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &t, nil
}

func (r *TagRepo) List(ctx context.Context) ([]Tag, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, name FROM tags ORDER BY name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Tag
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}
