package repository

import (
	"context"
	"database/sql"
)

// MerchantRuleRepo stores categorization rules.
type MerchantRuleRepo struct{ db *sql.DB }

func NewMerchantRuleRepo(db *sql.DB) *MerchantRuleRepo { return &MerchantRuleRepo{db: db} }

func (r *MerchantRuleRepo) Add(ctx context.Context, mr MerchantRule) error {
	_, err := r.db.ExecContext(ctx, `
	INSERT INTO merchant_rules(id, pattern, pattern_type, category_id, confidence, source, created_at)
	VALUES(?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`, mr.ID, mr.Pattern, mr.PatternType, mr.CategoryID, mr.Confidence, mr.Source)
	return err
}

func (r *MerchantRuleRepo) Match(ctx context.Context, description string) (*MerchantRule, error) {
	// Simplified: exact and contains implemented; regex omitted for MVP.
	row := r.db.QueryRowContext(ctx, `
	SELECT id, pattern, pattern_type, category_id, confidence, source, created_at
	FROM merchant_rules WHERE pattern_type = 'exact' AND pattern = ?
	`, description)
	var mr MerchantRule
	if err := row.Scan(&mr.ID, &mr.Pattern, &mr.PatternType, &mr.CategoryID, &mr.Confidence, &mr.Source, &mr.CreatedAt); err == nil {
		return &mr, nil
	}
	// contains fallback
	row = r.db.QueryRowContext(ctx, `
	SELECT id, pattern, pattern_type, category_id, confidence, source, created_at
	FROM merchant_rules WHERE pattern_type = 'contains' AND ? LIKE '%' || pattern || '%'
	ORDER BY confidence DESC LIMIT 1
	`, description)
	if err := row.Scan(&mr.ID, &mr.Pattern, &mr.PatternType, &mr.CategoryID, &mr.Confidence, &mr.Source, &mr.CreatedAt); err == nil {
		return &mr, nil
	}
	return nil, nil
}
