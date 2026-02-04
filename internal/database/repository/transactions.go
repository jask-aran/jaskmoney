package repository

import (
	"context"
	"database/sql"
	"strings"
	"time"
)

// TransactionFilters defines list filters.
type TransactionFilters struct {
	Status     string
	AccountID  string
	CategoryID string
	Month      time.Time // use first day of month; zero time = no month filter
	Search     string
}

// TransactionRepo handles transactions.
type TransactionRepo struct {
	db *sql.DB
}

func NewTransactionRepo(db *sql.DB) *TransactionRepo { return &TransactionRepo{db: db} }

func (r *TransactionRepo) Insert(ctx context.Context, t Transaction) error {
	_, err := r.db.ExecContext(ctx, `
	INSERT INTO transactions(
	 id, account_id, external_id, date, posted_date, amount, raw_description, merchant_name,
	 category_id, comment, status, source_hash, created_at, updated_at)
	VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
	`,
		t.ID, t.AccountID, t.ExternalID, t.Date, t.PostedDate, t.AmountCents, t.RawDescription,
		t.MerchantName, t.CategoryID, t.Comment, t.Status, t.SourceHash)
	return err
}

func (r *TransactionRepo) UpdateCategory(ctx context.Context, id string, categoryID *string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE transactions SET category_id = ?, updated_at=CURRENT_TIMESTAMP WHERE id = ?`, categoryID, id)
	return err
}

func (r *TransactionRepo) UpdateMerchant(ctx context.Context, id string, merchant *string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE transactions SET merchant_name = ?, updated_at=CURRENT_TIMESTAMP WHERE id = ?`, merchant, id)
	return err
}

func (r *TransactionRepo) UpdateStatus(ctx context.Context, id string, status string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE transactions SET status = ?, updated_at=CURRENT_TIMESTAMP WHERE id = ?`, status, id)
	return err
}

func (r *TransactionRepo) AttachTag(ctx context.Context, transactionID, tagID string) error {
	_, err := r.db.ExecContext(ctx, `INSERT OR IGNORE INTO transaction_tags(transaction_id, tag_id) VALUES(?, ?)`, transactionID, tagID)
	return err
}

func (r *TransactionRepo) RemoveTag(ctx context.Context, transactionID, tagID string) error {
	_, err := r.db.ExecContext(ctx, `DELETE FROM transaction_tags WHERE transaction_id = ? AND tag_id = ?`, transactionID, tagID)
	return err
}

func (r *TransactionRepo) List(ctx context.Context, f TransactionFilters) ([]Transaction, error) {
	var where []string
	var args []interface{}

	if f.Status != "" {
		where = append(where, "status = ?")
		args = append(args, f.Status)
	}
	if f.AccountID != "" {
		where = append(where, "account_id = ?")
		args = append(args, f.AccountID)
	}
	if f.CategoryID != "" {
		where = append(where, "category_id = ?")
		args = append(args, f.CategoryID)
	}
	if !f.Month.IsZero() {
		start := time.Date(f.Month.Year(), f.Month.Month(), 1, 0, 0, 0, 0, time.UTC)
		end := start.AddDate(0, 1, 0)
		where = append(where, "date >= ? AND date < ?")
		args = append(args, start, end)
	}
	if f.Search != "" {
		where = append(where, "raw_description LIKE ?")
		args = append(args, "%"+f.Search+"%")
	}

	query := "SELECT id, account_id, external_id, date, posted_date, amount, raw_description, merchant_name, category_id, comment, status, source_hash, created_at, updated_at FROM transactions"
	if len(where) > 0 {
		query += " WHERE " + strings.Join(where, " AND ")
	}
	query += " ORDER BY date DESC, created_at DESC"

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []Transaction
	for rows.Next() {
		t, err := scanTransaction(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for i := range out {
		tags, err := r.fetchTags(ctx, out[i].ID)
		if err != nil {
			return nil, err
		}
		out[i].Tags = tags
	}
	return out, nil
}

func (r *TransactionRepo) fetchTags(ctx context.Context, transactionID string) ([]Tag, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT t.id, t.name FROM tags t JOIN transaction_tags tt ON tt.tag_id = t.id WHERE tt.transaction_id = ? ORDER BY t.name`, transactionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var tags []Tag
	for rows.Next() {
		var t Tag
		if err := rows.Scan(&t.ID, &t.Name); err != nil {
			return nil, err
		}
		tags = append(tags, t)
	}
	return tags, rows.Err()
}

// CountByStatusForMonth returns stats for dashboard.
func (r *TransactionRepo) CountByStatusForMonth(ctx context.Context, month time.Time) (total int, uncategorized int, err error) {
	start := time.Date(month.Year(), month.Month(), 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0)
	row := r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM transactions WHERE date >= ? AND date < ?`, start, end)
	if err = row.Scan(&total); err != nil {
		return
	}
	row = r.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM transactions WHERE date >= ? AND date < ? AND category_id IS NULL`, start, end)
	if err = row.Scan(&uncategorized); err != nil {
		return
	}
	return
}

// SumByCategoryForMonth returns sums per category for dashboard.
type CategoryTotal struct {
	CategoryID string
	TotalCents int64
}

func (r *TransactionRepo) SumByCategoryForMonth(ctx context.Context, month time.Time) ([]CategoryTotal, error) {
	start := time.Date(month.Year(), month.Month(), 1, 0, 0, 0, 0, time.UTC)
	end := start.AddDate(0, 1, 0)
	rows, err := r.db.QueryContext(ctx, `
	SELECT COALESCE(category_id, ''), SUM(amount) as total
	FROM transactions
	WHERE date >= ? AND date < ?
	GROUP BY category_id
	ORDER BY total ASC;
	`, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CategoryTotal
	for rows.Next() {
		var ct CategoryTotal
		if err := rows.Scan(&ct.CategoryID, &ct.TotalCents); err != nil {
			return nil, err
		}
		out = append(out, ct)
	}
	return out, rows.Err()
}

// PendingCandidates returns pairs for reconciliation fuzzy matching.
type CandidatePair struct {
	A Transaction
	B Transaction
}

func (r *TransactionRepo) PendingCandidates(ctx context.Context) ([]Transaction, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, account_id, external_id, date, posted_date, amount, raw_description, merchant_name, category_id, comment, status, source_hash, created_at, updated_at FROM transactions WHERE status != 'reconciled'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Transaction
	for rows.Next() {
		t, err := scanTransaction(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (r *TransactionRepo) Get(ctx context.Context, id string) (*Transaction, error) {
	row := r.db.QueryRowContext(ctx, `SELECT id, account_id, external_id, date, posted_date, amount, raw_description, merchant_name, category_id, comment, status, source_hash, created_at, updated_at FROM transactions WHERE id = ?`, id)
	t, err := scanTransaction(row)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	tags, err := r.fetchTags(ctx, t.ID)
	if err != nil {
		return nil, err
	}
	t.Tags = tags
	return &t, nil
}

// scanTransaction handles nullable fields for both Row and Rows.
type scanner interface {
	Scan(dest ...interface{}) error
}

func scanTransaction(row scanner) (Transaction, error) {
	var t Transaction
	var external, merchant, category, comment, source sql.NullString
	var posted sql.NullTime
	if err := row.Scan(&t.ID, &t.AccountID, &external, &t.Date, &posted, &t.AmountCents,
		&t.RawDescription, &merchant, &category, &comment, &t.Status, &source, &t.CreatedAt, &t.UpdatedAt); err != nil {
		return Transaction{}, err
	}
	if external.Valid {
		t.ExternalID = &external.String
	}
	if posted.Valid {
		t.PostedDate = &posted.Time
	}
	if merchant.Valid {
		t.MerchantName = &merchant.String
	}
	if category.Valid {
		t.CategoryID = &category.String
	}
	if comment.Valid {
		t.Comment = &comment.String
	}
	if source.Valid {
		t.SourceHash = &source.String
	}
	return t, nil
}
