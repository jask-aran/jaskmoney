package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

type TimeValue struct {
	Key   string
	Value float64
}

type CategoryValue struct {
	CategoryID    int
	CategoryName  string
	CategoryColor string
	Value         float64
}

type ImportRecord struct {
	ID         int
	Filename   string
	RowCount   int
	ImportedAt string
}

type SavedFilter struct {
	ID        string
	Name      string
	Expr      string
	UpdatedAt string
}

type FilterUsageState struct {
	FilterID     string
	UseCount     int
	LastUsedUnix int64
}

type RuleV2 struct {
	ID           int
	Name         string
	SavedFilter  string
	SetCategory  sql.NullInt64
	AddTagIDsRaw string
	SortOrder    int
	Enabled      bool
	CreatedAt    string
}

type CategoryBudget struct {
	ID         int
	CategoryID int
	Amount     float64
}

type BudgetOverride struct {
	ID       int
	BudgetID int
	MonthKey string
	Amount   float64
}

type SpendingTarget struct {
	ID           int
	Name         string
	SavedFilter  string
	Amount       float64
	PeriodType   string
	CreatedAtISO string
}

type TargetOverride struct {
	ID        int
	TargetID  int
	PeriodKey string
	Amount    float64
}

type CreditOffset struct {
	ID          int
	CreditTxnID int
	DebitTxnID  int
	Amount      float64
}

type DBStats struct {
	Accounts     int
	Transactions int
	Categories   int
	Tags         int
	Imports      int
	Rules        int
	Filters      int
}

type TransactionJoined struct {
	ID            int
	AccountID     int
	AccountName   string
	DateISO       string
	Amount        float64
	Description   string
	CategoryID    sql.NullInt64
	CategoryName  string
	CategoryColor string
	Notes         string
	TagNames      []string
}

type ManagedAccount struct {
	ID       int
	Name     string
	Type     string
	Prefix   string
	Active   bool
	TxnCount int
}

func LoadDBStats(db *sql.DB) (DBStats, error) {
	if db == nil {
		return DBStats{}, fmt.Errorf("database is nil")
	}
	stats := DBStats{}
	var err error
	if stats.Accounts, err = countRows(db, "accounts"); err != nil {
		return DBStats{}, err
	}
	if stats.Transactions, err = countRows(db, "transactions"); err != nil {
		return DBStats{}, err
	}
	if stats.Categories, err = countRows(db, "categories"); err != nil {
		return DBStats{}, err
	}
	if stats.Tags, err = countRows(db, "tags"); err != nil {
		return DBStats{}, err
	}
	if stats.Imports, err = countRows(db, "imports"); err != nil {
		return DBStats{}, err
	}
	if stats.Rules, err = countRows(db, "rules_v2"); err != nil {
		return DBStats{}, err
	}
	if stats.Filters, err = countRows(db, "saved_filters"); err != nil {
		return DBStats{}, err
	}
	return stats, nil
}

func LoadImportHistory(db *sql.DB, limit int) ([]ImportRecord, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	if limit <= 0 {
		limit = 50
	}
	rows, err := db.Query(`SELECT id, filename, row_count, imported_at FROM imports ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ImportRecord, 0, limit)
	for rows.Next() {
		var row ImportRecord
		if err := rows.Scan(&row.ID, &row.Filename, &row.RowCount, &row.ImportedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func LoadSavedFilters(db *sql.DB) ([]SavedFilter, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	rows, err := db.Query(`SELECT id, name, expr, updated_at FROM saved_filters ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]SavedFilter, 0, 16)
	for rows.Next() {
		var row SavedFilter
		if err := rows.Scan(&row.ID, &row.Name, &row.Expr, &row.UpdatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func UpsertSavedFilter(db *sql.DB, sf SavedFilter) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	sf.ID = strings.TrimSpace(strings.ToLower(sf.ID))
	sf.Name = strings.TrimSpace(sf.Name)
	sf.Expr = strings.TrimSpace(sf.Expr)
	if sf.ID == "" {
		return fmt.Errorf("filter id is required")
	}
	if sf.Name == "" {
		return fmt.Errorf("filter name is required")
	}
	if sf.Expr == "" {
		return fmt.Errorf("filter expression is required")
	}
	_, err := db.Exec(`
		INSERT INTO saved_filters(id, name, expr, created_at, updated_at)
		VALUES(?, ?, ?, datetime('now'), datetime('now'))
		ON CONFLICT(id) DO UPDATE SET
			name = excluded.name,
			expr = excluded.expr,
			updated_at = datetime('now')
	`, sf.ID, sf.Name, sf.Expr)
	return err
}

func DeleteSavedFilter(db *sql.DB, id string) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	id = strings.TrimSpace(strings.ToLower(id))
	if id == "" {
		return fmt.Errorf("filter id is required")
	}
	if _, err := db.Exec(`DELETE FROM saved_filters WHERE id = ?`, id); err != nil {
		return err
	}
	_, err := db.Exec(`DELETE FROM filter_usage_state WHERE filter_id = ?`, id)
	return err
}

func LoadFilterUsageState(db *sql.DB) (map[string]FilterUsageState, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	rows, err := db.Query(`SELECT filter_id, use_count, last_used_unix FROM filter_usage_state`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]FilterUsageState{}
	for rows.Next() {
		var row FilterUsageState
		if err := rows.Scan(&row.FilterID, &row.UseCount, &row.LastUsedUnix); err != nil {
			return nil, err
		}
		row.FilterID = strings.TrimSpace(strings.ToLower(row.FilterID))
		out[row.FilterID] = row
	}
	return out, rows.Err()
}

func TouchFilterUsageState(db *sql.DB, filterID string, incrementUseCount bool) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	filterID = strings.TrimSpace(strings.ToLower(filterID))
	if filterID == "" {
		return fmt.Errorf("filter id is required")
	}
	incr := 0
	if incrementUseCount {
		incr = 1
	}
	now := time.Now().Unix()
	_, err := db.Exec(`
		INSERT INTO filter_usage_state(filter_id, use_count, last_used_unix)
		VALUES(?, ?, ?)
		ON CONFLICT(filter_id) DO UPDATE SET
			use_count = filter_usage_state.use_count + ?,
			last_used_unix = excluded.last_used_unix
	`, filterID, incr, now, incr)
	return err
}

func LoadRulesV2(db *sql.DB) ([]RuleV2, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	rows, err := db.Query(`
		SELECT id, name, saved_filter_id, set_category_id, add_tag_ids, sort_order, enabled, created_at
		FROM rules_v2
		ORDER BY sort_order, id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]RuleV2, 0, 32)
	for rows.Next() {
		var row RuleV2
		var enabled int
		if err := rows.Scan(
			&row.ID,
			&row.Name,
			&row.SavedFilter,
			&row.SetCategory,
			&row.AddTagIDsRaw,
			&row.SortOrder,
			&enabled,
			&row.CreatedAt,
		); err != nil {
			return nil, err
		}
		row.Enabled = enabled == 1
		out = append(out, row)
	}
	return out, rows.Err()
}

func LoadCategoryBudgets(db *sql.DB) ([]CategoryBudget, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	rows, err := db.Query(`SELECT id, category_id, amount FROM category_budgets ORDER BY category_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CategoryBudget, 0, 32)
	for rows.Next() {
		var row CategoryBudget
		if err := rows.Scan(&row.ID, &row.CategoryID, &row.Amount); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func UpsertCategoryBudget(db *sql.DB, categoryID int, amount float64) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	if categoryID <= 0 {
		return fmt.Errorf("category id must be > 0")
	}
	_, err := db.Exec(`
		INSERT INTO category_budgets(category_id, amount)
		VALUES(?, ?)
		ON CONFLICT(category_id) DO UPDATE SET
			amount = excluded.amount
	`, categoryID, amount)
	return err
}

func LoadBudgetOverrides(db *sql.DB) (map[int][]BudgetOverride, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	rows, err := db.Query(`SELECT id, budget_id, month_key, amount FROM category_budget_overrides ORDER BY month_key, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int][]BudgetOverride{}
	for rows.Next() {
		var row BudgetOverride
		if err := rows.Scan(&row.ID, &row.BudgetID, &row.MonthKey, &row.Amount); err != nil {
			return nil, err
		}
		out[row.BudgetID] = append(out[row.BudgetID], row)
	}
	return out, rows.Err()
}

func UpsertBudgetOverride(db *sql.DB, budgetID int, monthKey string, amount float64) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	if budgetID <= 0 {
		return fmt.Errorf("budget id must be > 0")
	}
	monthKey = strings.TrimSpace(monthKey)
	if !isYearMonth(monthKey) {
		return fmt.Errorf("invalid month key %q", monthKey)
	}
	_, err := db.Exec(`
		INSERT INTO category_budget_overrides(budget_id, month_key, amount)
		VALUES(?, ?, ?)
		ON CONFLICT(budget_id, month_key) DO UPDATE SET
			amount = excluded.amount
	`, budgetID, monthKey, amount)
	return err
}

func DeleteBudgetOverride(db *sql.DB, budgetID int, monthKey string) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	_, err := db.Exec(`DELETE FROM category_budget_overrides WHERE budget_id = ? AND month_key = ?`, budgetID, strings.TrimSpace(monthKey))
	return err
}

func LoadSpendingTargets(db *sql.DB) ([]SpendingTarget, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	rows, err := db.Query(`SELECT id, name, saved_filter_id, amount, period_type, created_at FROM spending_targets ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]SpendingTarget, 0, 16)
	for rows.Next() {
		var row SpendingTarget
		if err := rows.Scan(&row.ID, &row.Name, &row.SavedFilter, &row.Amount, &row.PeriodType, &row.CreatedAtISO); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func UpsertSpendingTarget(db *sql.DB, target SpendingTarget) (int, error) {
	if db == nil {
		return 0, fmt.Errorf("database is nil")
	}
	target.Name = strings.TrimSpace(target.Name)
	target.SavedFilter = strings.TrimSpace(strings.ToLower(target.SavedFilter))
	target.PeriodType = normalizePeriodType(target.PeriodType)
	if target.Name == "" {
		return 0, fmt.Errorf("target name is required")
	}
	if target.SavedFilter == "" {
		return 0, fmt.Errorf("target saved filter is required")
	}
	if target.ID <= 0 {
		res, err := db.Exec(
			`INSERT INTO spending_targets(name, saved_filter_id, amount, period_type) VALUES(?, ?, ?, ?)`,
			target.Name,
			target.SavedFilter,
			target.Amount,
			target.PeriodType,
		)
		if err != nil {
			return 0, err
		}
		lastID, err := res.LastInsertId()
		if err != nil {
			return 0, err
		}
		return int(lastID), nil
	}
	if _, err := db.Exec(
		`UPDATE spending_targets SET name = ?, saved_filter_id = ?, amount = ?, period_type = ? WHERE id = ?`,
		target.Name,
		target.SavedFilter,
		target.Amount,
		target.PeriodType,
		target.ID,
	); err != nil {
		return 0, err
	}
	return target.ID, nil
}

func DeleteSpendingTarget(db *sql.DB, id int) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	if id <= 0 {
		return fmt.Errorf("target id must be > 0")
	}
	_, err := db.Exec(`DELETE FROM spending_targets WHERE id = ?`, id)
	return err
}

func LoadTargetOverrides(db *sql.DB) (map[int][]TargetOverride, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	rows, err := db.Query(`SELECT id, target_id, period_key, amount FROM spending_target_overrides ORDER BY period_key, id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int][]TargetOverride{}
	for rows.Next() {
		var row TargetOverride
		if err := rows.Scan(&row.ID, &row.TargetID, &row.PeriodKey, &row.Amount); err != nil {
			return nil, err
		}
		out[row.TargetID] = append(out[row.TargetID], row)
	}
	return out, rows.Err()
}

func UpsertTargetOverride(db *sql.DB, targetID int, periodKey string, amount float64) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	if targetID <= 0 {
		return fmt.Errorf("target id must be > 0")
	}
	periodKey = strings.TrimSpace(periodKey)
	if periodKey == "" {
		return fmt.Errorf("period key is required")
	}
	_, err := db.Exec(`
		INSERT INTO spending_target_overrides(target_id, period_key, amount)
		VALUES(?, ?, ?)
		ON CONFLICT(target_id, period_key) DO UPDATE SET
			amount = excluded.amount
	`, targetID, periodKey, amount)
	return err
}

func LoadCreditOffsets(db *sql.DB) ([]CreditOffset, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	rows, err := db.Query(`SELECT id, credit_txn_id, debit_txn_id, amount FROM credit_offsets ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CreditOffset, 0, 32)
	for rows.Next() {
		var row CreditOffset
		if err := rows.Scan(&row.ID, &row.CreditTxnID, &row.DebitTxnID, &row.Amount); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func InsertCreditOffset(db *sql.DB, creditTxnID, debitTxnID int, amount float64) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	if creditTxnID <= 0 || debitTxnID <= 0 {
		return fmt.Errorf("transaction ids must be > 0")
	}
	if amount <= 0 {
		return fmt.Errorf("amount must be > 0")
	}
	_, err := db.Exec(`INSERT INTO credit_offsets(credit_txn_id, debit_txn_id, amount) VALUES(?, ?, ?)`, creditTxnID, debitTxnID, amount)
	return err
}

func DeleteCreditOffset(db *sql.DB, id int) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	_, err := db.Exec(`DELETE FROM credit_offsets WHERE id = ?`, id)
	return err
}

func QueryDailyDebitSpend(db *sql.DB, startISO, endISO string, accountIDs []int) ([]TimeValue, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	args := make([]any, 0, 4+len(accountIDs))
	query := `
		SELECT date_iso, COALESCE(SUM(-amount), 0)
		FROM transactions
		WHERE amount < 0
	`
	query, args = appendDateRangeClause(query, args, startISO, endISO)
	query, args = appendIntScopeClause(query, args, "account_id", accountIDs)
	query += ` GROUP BY date_iso ORDER BY date_iso`

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]TimeValue, 0, 64)
	for rows.Next() {
		var row TimeValue
		if err := rows.Scan(&row.Key, &row.Value); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func QueryCategoryDebitSpend(db *sql.DB, startISO, endISO string, accountIDs []int) ([]CategoryValue, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	args := make([]any, 0, 4+len(accountIDs))
	query := `
		SELECT
			COALESCE(c.id, 0),
			COALESCE(c.name, 'Uncategorised'),
			COALESCE(c.color, '#7f849c'),
			COALESCE(SUM(-t.amount), 0)
		FROM transactions t
		LEFT JOIN categories c ON c.id = t.category_id
		WHERE t.amount < 0
	`
	query, args = appendDateRangeClause(query, args, startISO, endISO)
	query, args = appendIntScopeClause(query, args, "t.account_id", accountIDs)
	query += ` GROUP BY c.id, c.name, c.color ORDER BY 4 DESC, 2`

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]CategoryValue, 0, 32)
	for rows.Next() {
		var row CategoryValue
		if err := rows.Scan(&row.CategoryID, &row.CategoryName, &row.CategoryColor, &row.Value); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func QueryTransactionsJoined(db *sql.DB, startISO, endISO string, accountIDs []int) ([]TransactionJoined, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	args := make([]any, 0, 4+len(accountIDs))
	query := `
		SELECT
			t.id,
			t.account_id,
			COALESCE(a.name, ''),
			t.date_iso,
			t.amount,
			t.description,
			t.category_id,
			COALESCE(c.name, 'Uncategorised'),
			COALESCE(c.color, '#7f849c'),
			COALESCE(t.notes, '')
		FROM transactions t
		LEFT JOIN accounts a ON a.id = t.account_id
		LEFT JOIN categories c ON c.id = t.category_id
		WHERE 1=1
	`
	query, args = appendDateRangeClause(query, args, startISO, endISO)
	query, args = appendIntScopeClause(query, args, "t.account_id", accountIDs)
	query += ` ORDER BY t.import_index ASC, t.id ASC`

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]TransactionJoined, 0, 256)
	ids := make([]int, 0, 256)
	for rows.Next() {
		var row TransactionJoined
		if err := rows.Scan(
			&row.ID,
			&row.AccountID,
			&row.AccountName,
			&row.DateISO,
			&row.Amount,
			&row.Description,
			&row.CategoryID,
			&row.CategoryName,
			&row.CategoryColor,
			&row.Notes,
		); err != nil {
			return nil, err
		}
		out = append(out, row)
		ids = append(ids, row.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	tagMap, err := loadTagNamesByTxnID(db, ids)
	if err != nil {
		return nil, err
	}
	for i := range out {
		out[i].TagNames = tagMap[out[i].ID]
	}
	return out, nil
}

func loadTagNamesByTxnID(db *sql.DB, txnIDs []int) (map[int][]string, error) {
	out := map[int][]string{}
	placeholders, args := intSliceClause(txnIDs)
	if placeholders == "" {
		return out, nil
	}
	query := `
		SELECT tt.transaction_id, tg.name
		FROM transaction_tags tt
		JOIN tags tg ON tg.id = tt.tag_id
		WHERE tt.transaction_id IN (` + placeholders + `)
		ORDER BY tt.transaction_id, lower(tg.name)
	`
	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var txnID int
		var tagName string
		if err := rows.Scan(&txnID, &tagName); err != nil {
			return nil, err
		}
		out[txnID] = append(out[txnID], tagName)
	}
	return out, rows.Err()
}

func appendDateRangeClause(query string, args []any, startISO, endISO string) (string, []any) {
	startISO = strings.TrimSpace(startISO)
	endISO = strings.TrimSpace(endISO)
	if startISO != "" {
		query += " AND date_iso >= ?"
		args = append(args, startISO)
	}
	if endISO != "" {
		query += " AND date_iso <= ?"
		args = append(args, endISO)
	}
	return query, args
}

func appendIntScopeClause(query string, args []any, column string, ids []int) (string, []any) {
	placeholders, values := intSliceClause(ids)
	if placeholders == "" {
		return query, args
	}
	query += " AND " + column + " IN (" + placeholders + ")"
	args = append(args, values...)
	return query, args
}

func intSliceClause(ids []int) (string, []any) {
	if len(ids) == 0 {
		return "", nil
	}
	dedup := map[int]bool{}
	order := make([]int, 0, len(ids))
	for _, id := range ids {
		if id <= 0 || dedup[id] {
			continue
		}
		dedup[id] = true
		order = append(order, id)
	}
	sort.Ints(order)
	if len(order) == 0 {
		return "", nil
	}
	parts := make([]string, len(order))
	args := make([]any, len(order))
	for i, id := range order {
		parts[i] = "?"
		args[i] = id
	}
	return strings.Join(parts, ","), args
}

func countRows(db *sql.DB, table string) (int, error) {
	table = strings.TrimSpace(table)
	if table == "" {
		return 0, fmt.Errorf("table is required")
	}
	var count int
	query := "SELECT COUNT(*) FROM " + table
	if err := db.QueryRow(query).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func normalizePeriodType(periodType string) string {
	switch strings.ToLower(strings.TrimSpace(periodType)) {
	case "monthly", "":
		return "monthly"
	case "quarterly":
		return "quarterly"
	case "annual", "yearly":
		return "annual"
	default:
		return "monthly"
	}
}

func isYearMonth(v string) bool {
	if len(v) != 7 {
		return false
	}
	if v[4] != '-' {
		return false
	}
	year, errYear := strconv.Atoi(v[:4])
	month, errMonth := strconv.Atoi(v[5:])
	if errYear != nil || errMonth != nil {
		return false
	}
	return year >= 1900 && month >= 1 && month <= 12
}

func LoadManagedAccounts(db *sql.DB) ([]ManagedAccount, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	rows, err := db.Query(`
		SELECT
			a.id,
			a.name,
			a.type,
			COALESCE(a.prefix, ''),
			COALESCE(a.active, 1),
			COALESCE(tx.txn_count, 0) AS txn_count
		FROM accounts a
		LEFT JOIN (
			SELECT account_id, COUNT(*) AS txn_count
			FROM transactions
			GROUP BY account_id
		) tx ON tx.account_id = a.id
		ORDER BY lower(a.name), a.id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]ManagedAccount, 0, 16)
	for rows.Next() {
		var row ManagedAccount
		var active int
		if err := rows.Scan(&row.ID, &row.Name, &row.Type, &row.Prefix, &active, &row.TxnCount); err != nil {
			return nil, err
		}
		row.Active = active == 1
		out = append(out, row)
	}
	return out, rows.Err()
}

func UpsertManagedAccount(db *sql.DB, account ManagedAccount) (int, error) {
	if db == nil {
		return 0, fmt.Errorf("database is nil")
	}
	name := strings.TrimSpace(account.Name)
	if name == "" {
		return 0, fmt.Errorf("account name is required")
	}
	typ := normalizeManagedAccountType(account.Type)
	prefix := strings.TrimSpace(account.Prefix)
	active := 0
	if account.Active {
		active = 1
	}
	if account.ID <= 0 {
		res, err := db.Exec(`INSERT INTO accounts(name, type, prefix, active) VALUES(?, ?, ?, ?)`, name, typ, prefix, active)
		if err != nil {
			return 0, err
		}
		lastID, err := res.LastInsertId()
		if err != nil {
			return 0, err
		}
		return int(lastID), nil
	}
	if _, err := db.Exec(`UPDATE accounts SET name = ?, type = ?, prefix = ?, active = ? WHERE id = ?`, name, typ, prefix, active, account.ID); err != nil {
		return 0, err
	}
	return account.ID, nil
}

func CountTransactionsForAccount(db *sql.DB, accountID int) (int, error) {
	if db == nil {
		return 0, fmt.Errorf("database is nil")
	}
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM transactions WHERE account_id = ?`, accountID).Scan(&count); err != nil {
		return 0, err
	}
	return count, nil
}

func ClearTransactionsForAccount(db *sql.DB, accountID int) (int, error) {
	if db == nil {
		return 0, fmt.Errorf("database is nil")
	}
	res, err := db.Exec(`DELETE FROM transactions WHERE account_id = ?`, accountID)
	if err != nil {
		return 0, err
	}
	affected, _ := res.RowsAffected()
	return int(affected), nil
}

func DeleteManagedAccountIfEmpty(db *sql.DB, accountID int) error {
	count, err := CountTransactionsForAccount(db, accountID)
	if err != nil {
		return err
	}
	if count > 0 {
		return fmt.Errorf("account has %d transactions; clear it first", count)
	}
	if _, err := db.Exec(`DELETE FROM account_selection WHERE account_id = ?`, accountID); err != nil {
		return err
	}
	_, err = db.Exec(`DELETE FROM accounts WHERE id = ?`, accountID)
	return err
}

func NukeManagedAccount(db *sql.DB, accountID int) (int, error) {
	if db == nil {
		return 0, fmt.Errorf("database is nil")
	}
	tx, err := db.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	res, err := tx.Exec(`DELETE FROM transactions WHERE account_id = ?`, accountID)
	if err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM account_selection WHERE account_id = ?`, accountID); err != nil {
		return 0, err
	}
	if _, err := tx.Exec(`DELETE FROM accounts WHERE id = ?`, accountID); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	affected, _ := res.RowsAffected()
	return int(affected), nil
}

func SaveSelectedAccounts(db *sql.DB, accountIDs []int) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.Exec(`DELETE FROM account_selection`); err != nil {
		return err
	}
	ids := make([]int, 0, len(accountIDs))
	seen := map[int]bool{}
	for _, id := range accountIDs {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	sort.Ints(ids)
	for _, id := range ids {
		if _, err := tx.Exec(`INSERT INTO account_selection(account_id) VALUES(?)`, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func LoadSelectedAccounts(db *sql.DB) (map[int]bool, error) {
	if db == nil {
		return nil, fmt.Errorf("database is nil")
	}
	rows, err := db.Query(`SELECT account_id FROM account_selection`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int]bool{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

func UpsertRuleV2(db *sql.DB, rule RuleV2) (int, error) {
	if db == nil {
		return 0, fmt.Errorf("database is nil")
	}
	rule.Name = strings.TrimSpace(rule.Name)
	rule.SavedFilter = strings.TrimSpace(strings.ToLower(rule.SavedFilter))
	if rule.Name == "" {
		return 0, fmt.Errorf("rule name is required")
	}
	if rule.SavedFilter == "" {
		return 0, fmt.Errorf("saved_filter_id is required")
	}
	if strings.TrimSpace(rule.AddTagIDsRaw) == "" {
		rule.AddTagIDsRaw = "[]"
	}
	if _, err := decodeRuleTagIDs(rule.AddTagIDsRaw); err != nil {
		return 0, fmt.Errorf("invalid add_tag_ids: %w", err)
	}

	enabled := 0
	if rule.Enabled {
		enabled = 1
	}

	if rule.ID <= 0 {
		sortOrder := 1
		if err := db.QueryRow(`SELECT COALESCE(MAX(sort_order), 0) + 1 FROM rules_v2`).Scan(&sortOrder); err != nil {
			return 0, err
		}
		res, err := db.Exec(`
			INSERT INTO rules_v2(name, saved_filter_id, set_category_id, add_tag_ids, sort_order, enabled, created_at)
			VALUES(?, ?, ?, ?, ?, ?, datetime('now'))
		`, rule.Name, rule.SavedFilter, nullableInt64(rule.SetCategory), rule.AddTagIDsRaw, sortOrder, enabled)
		if err != nil {
			return 0, err
		}
		lastID, err := res.LastInsertId()
		if err != nil {
			return 0, err
		}
		return int(lastID), nil
	}

	if _, err := db.Exec(`
		UPDATE rules_v2
		SET name = ?, saved_filter_id = ?, set_category_id = ?, add_tag_ids = ?, enabled = ?
		WHERE id = ?
	`, rule.Name, rule.SavedFilter, nullableInt64(rule.SetCategory), rule.AddTagIDsRaw, enabled, rule.ID); err != nil {
		return 0, err
	}
	return rule.ID, nil
}

func DeleteRuleV2(db *sql.DB, id int) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	if _, err := db.Exec(`DELETE FROM rules_v2 WHERE id = ?`, id); err != nil {
		return err
	}
	return NormalizeRuleSortOrder(db)
}

func ToggleRuleV2Enabled(db *sql.DB, id int, enabled bool) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	value := 0
	if enabled {
		value = 1
	}
	_, err := db.Exec(`UPDATE rules_v2 SET enabled = ? WHERE id = ?`, value, id)
	return err
}

func SaveRuleOrder(db *sql.DB, orderedRuleIDs []int) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for i, id := range orderedRuleIDs {
		if id <= 0 {
			continue
		}
		if _, err := tx.Exec(`UPDATE rules_v2 SET sort_order = ? WHERE id = ?`, i+1, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func NormalizeRuleSortOrder(db *sql.DB) error {
	if db == nil {
		return fmt.Errorf("database is nil")
	}
	rows, err := db.Query(`SELECT id FROM rules_v2 ORDER BY sort_order, id`)
	if err != nil {
		return err
	}
	defer rows.Close()
	ids := make([]int, 0, 32)
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	return SaveRuleOrder(db, ids)
}

func ParseRuleTagIDs(raw string) ([]int, error) {
	return decodeRuleTagIDs(raw)
}

func EncodeRuleTagIDs(ids []int) string {
	out := make([]int, 0, len(ids))
	seen := map[int]bool{}
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		out = append(out, id)
	}
	sort.Ints(out)
	body, err := json.Marshal(out)
	if err != nil {
		return "[]"
	}
	return string(body)
}

func decodeRuleTagIDs(raw string) ([]int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return nil, nil
	}
	if strings.HasPrefix(raw, "[") {
		var ids []int
		if err := json.Unmarshal([]byte(raw), &ids); err != nil {
			return nil, err
		}
		return ids, nil
	}
	parts := strings.Split(raw, ",")
	ids := make([]int, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		id, err := strconv.Atoi(part)
		if err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, nil
}

func normalizeManagedAccountType(v string) string {
	v = strings.ToLower(strings.TrimSpace(v))
	switch v {
	case "credit":
		return "credit"
	case "debit", "checking", "savings":
		return "debit"
	default:
		return "debit"
	}
}

func nullableInt64(v sql.NullInt64) any {
	if v.Valid {
		return v.Int64
	}
	return nil
}
