package repository

import (
	"context"
	"database/sql"
)

// ReconciliationRepo handles pending duplicates.
type ReconciliationRepo struct{ db *sql.DB }

func NewReconciliationRepo(db *sql.DB) *ReconciliationRepo { return &ReconciliationRepo{db: db} }

func (r *ReconciliationRepo) Add(ctx context.Context, pr PendingReconciliation) error {
	_, err := r.db.ExecContext(ctx, `
	INSERT INTO pending_reconciliations(
	 id, transaction_a_id, transaction_b_id, similarity_score, llm_confidence, llm_reasoning, status, created_at)
	VALUES(?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`, pr.ID, pr.TransactionAID, pr.TransactionBID, pr.Similarity, pr.LLMConfidence, pr.LLMReasoning, pr.Status)
	return err
}

func (r *ReconciliationRepo) ListPending(ctx context.Context) ([]PendingReconciliation, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, transaction_a_id, transaction_b_id, similarity_score, llm_confidence, llm_reasoning, status, created_at FROM pending_reconciliations WHERE status='pending' ORDER BY created_at ASC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []PendingReconciliation
	for rows.Next() {
		var pr PendingReconciliation
		if err := rows.Scan(&pr.ID, &pr.TransactionAID, &pr.TransactionBID, &pr.Similarity, &pr.LLMConfidence, &pr.LLMReasoning, &pr.Status, &pr.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, pr)
	}
	return out, rows.Err()
}

func (r *ReconciliationRepo) UpdateStatus(ctx context.Context, id, status string) error {
	_, err := r.db.ExecContext(ctx, `UPDATE pending_reconciliations SET status = ? WHERE id = ?`, status, id)
	return err
}

func (r *ReconciliationRepo) Get(ctx context.Context, id string) (*PendingReconciliation, error) {
	row := r.db.QueryRowContext(ctx, `SELECT id, transaction_a_id, transaction_b_id, similarity_score, llm_confidence, llm_reasoning, status, created_at FROM pending_reconciliations WHERE id = ?`, id)
	var pr PendingReconciliation
	if err := row.Scan(&pr.ID, &pr.TransactionAID, &pr.TransactionBID, &pr.Similarity, &pr.LLMConfidence, &pr.LLMReasoning, &pr.Status, &pr.CreatedAt); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &pr, nil
}
