package main

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"
)

type categoryBudget struct {
	id         int
	categoryID int
	amount     float64
}

type budgetOverride struct {
	id       int
	budgetID int
	monthKey string
	amount   float64
}

type spendingTarget struct {
	id            int
	name          string
	savedFilterID string
	amount        float64
	periodType    string
}

type targetOverride struct {
	id        int
	targetID  int
	periodKey string
	amount    float64
}

type creditOffset struct {
	id          int
	creditTxnID int
	debitTxnID  int
	amount      float64
}

type budgetLine struct {
	categoryID    int
	categoryName  string
	categoryColor string
	budgeted      float64
	spent         float64
	offsets       float64
	netSpent      float64
	remaining     float64
	overBudget    bool
}

type targetLine struct {
	targetID   int
	name       string
	budgeted   float64
	spent      float64
	offsets    float64
	netSpent   float64
	remaining  float64
	overBudget bool
	periodType string
	periodKey  string
}

func parseMonthKey(month string) (time.Time, time.Time, error) {
	start, err := time.Parse("2006-01", strings.TrimSpace(month))
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("parse month key %q: %w", month, err)
	}
	end := start.AddDate(0, 1, 0)
	return start, end, nil
}

func currentPeriodKeyAndRange(periodType string, now time.Time) (string, time.Time, time.Time, error) {
	switch strings.ToLower(strings.TrimSpace(periodType)) {
	case "monthly":
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		end := start.AddDate(0, 1, 0)
		return start.Format("2006-01"), start, end, nil
	case "quarterly":
		month := int(now.Month())
		quarter := (month-1)/3 + 1
		startMonth := time.Month((quarter-1)*3 + 1)
		start := time.Date(now.Year(), startMonth, 1, 0, 0, 0, 0, time.UTC)
		end := start.AddDate(0, 3, 0)
		return fmt.Sprintf("%04d-Q%d", now.Year(), quarter), start, end, nil
	case "annual":
		start := time.Date(now.Year(), time.January, 1, 0, 0, 0, 0, time.UTC)
		end := start.AddDate(1, 0, 0)
		return fmt.Sprintf("%04d", now.Year()), start, end, nil
	default:
		return "", time.Time{}, time.Time{}, fmt.Errorf("invalid period type %q", periodType)
	}
}

func accountFilterIDs(accountFilter map[int]bool) []int {
	if len(accountFilter) == 0 {
		return nil
	}
	ids := make([]int, 0, len(accountFilter))
	for id, on := range accountFilter {
		if on {
			ids = append(ids, id)
		}
	}
	sort.Ints(ids)
	return ids
}

func queryDebitSpendByCategory(db *sql.DB, startISO, endISO string, accountFilter map[int]bool) (map[int]float64, error) {
	ids := accountFilterIDs(accountFilter)
	args := []any{startISO, endISO}
	query := `
		SELECT t.category_id, COALESCE(SUM(-t.amount), 0)
		FROM transactions t
		WHERE t.amount < 0
		  AND t.date_iso >= ?
		  AND t.date_iso < ?
	`
	if len(ids) > 0 {
		placeholders := make([]string, len(ids))
		for i, id := range ids {
			placeholders[i] = "?"
			args = append(args, id)
		}
		query += " AND t.account_id IN (" + strings.Join(placeholders, ",") + ")"
	}
	query += " GROUP BY t.category_id"

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query budget debit aggregates: %w", err)
	}
	defer rows.Close()

	out := make(map[int]float64)
	for rows.Next() {
		var categoryID sql.NullInt64
		var spend float64
		if err := rows.Scan(&categoryID, &spend); err != nil {
			return nil, fmt.Errorf("scan budget debit aggregate: %w", err)
		}
		if categoryID.Valid {
			out[int(categoryID.Int64)] = spend
		}
	}
	return out, rows.Err()
}

func queryOffsetSpendByCategory(db *sql.DB, startISO, endISO string, accountFilter map[int]bool) (map[int]float64, error) {
	ids := accountFilterIDs(accountFilter)
	args := []any{startISO, endISO}
	query := `
		SELECT d.category_id, COALESCE(SUM(off.amount), 0)
		FROM (
			SELECT debit_txn_id, amount FROM credit_offsets
			UNION ALL
			SELECT debit_txn_id, amount FROM manual_offsets
		) off
		JOIN transactions d ON d.id = off.debit_txn_id
		WHERE d.amount < 0
		  AND d.date_iso >= ?
		  AND d.date_iso < ?
	`
	if len(ids) > 0 {
		placeholders := make([]string, len(ids))
		for i, id := range ids {
			placeholders[i] = "?"
			args = append(args, id)
		}
		query += " AND d.account_id IN (" + strings.Join(placeholders, ",") + ")"
	}
	query += " GROUP BY d.category_id"

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query budget offset aggregates: %w", err)
	}
	defer rows.Close()

	out := make(map[int]float64)
	for rows.Next() {
		var categoryID sql.NullInt64
		var offsets float64
		if err := rows.Scan(&categoryID, &offsets); err != nil {
			return nil, fmt.Errorf("scan budget offset aggregate: %w", err)
		}
		if categoryID.Valid {
			out[int(categoryID.Int64)] = offsets
		}
	}
	return out, rows.Err()
}

func computeBudgetLines(db *sql.DB, budgets []categoryBudget, overrides map[int][]budgetOverride, offsetsByDebit map[int][]creditOffset, month string, accountFilter map[int]bool) ([]budgetLine, error) {
	_ = offsetsByDebit // offsets are aggregated in one query by category for scoped month.
	start, end, err := parseMonthKey(month)
	if err != nil {
		return nil, err
	}

	debitByCategory, err := queryDebitSpendByCategory(db, start.Format("2006-01-02"), end.Format("2006-01-02"), accountFilter)
	if err != nil {
		return nil, err
	}
	offsetByCategory, err := queryOffsetSpendByCategory(db, start.Format("2006-01-02"), end.Format("2006-01-02"), accountFilter)
	if err != nil {
		return nil, err
	}

	cats, err := loadCategories(db)
	if err != nil {
		return nil, err
	}
	catByID := make(map[int]category, len(cats))
	for _, c := range cats {
		catByID[c.id] = c
	}

	sortable := make([]categoryBudget, len(budgets))
	copy(sortable, budgets)
	sort.SliceStable(sortable, func(i, j int) bool {
		ci, iok := catByID[sortable[i].categoryID]
		cj, jok := catByID[sortable[j].categoryID]
		if iok && jok {
			if ci.sortOrder != cj.sortOrder {
				return ci.sortOrder < cj.sortOrder
			}
			return strings.ToLower(ci.name) < strings.ToLower(cj.name)
		}
		return sortable[i].categoryID < sortable[j].categoryID
	})

	lines := make([]budgetLine, 0, len(sortable))
	for _, b := range sortable {
		effective := b.amount
		if ovs := overrides[b.id]; len(ovs) > 0 {
			for _, ov := range ovs {
				if ov.monthKey == month {
					effective = ov.amount
					break
				}
			}
		}
		cat := catByID[b.categoryID]
		spent := debitByCategory[b.categoryID]
		offsets := offsetByCategory[b.categoryID]
		net := spent - offsets
		remaining := effective - net
		lines = append(lines, budgetLine{
			categoryID:    b.categoryID,
			categoryName:  cat.name,
			categoryColor: cat.color,
			budgeted:      effective,
			spent:         spent,
			offsets:       offsets,
			netSpent:      net,
			remaining:     remaining,
			overBudget:    remaining < 0,
		})
	}
	return lines, nil
}

func computeTargetLines(db *sql.DB, targets []spendingTarget, overrides map[int][]targetOverride, offsetsByDebit map[int][]creditOffset, txnTags map[int][]tag, savedFilters []savedFilter, accountFilter map[int]bool) ([]targetLine, error) {
	byFilterID := make(map[string]savedFilter, len(savedFilters))
	for _, sf := range savedFilters {
		byFilterID[strings.ToLower(strings.TrimSpace(sf.ID))] = sf
	}
	now := time.Now().UTC()
	lines := make([]targetLine, 0, len(targets))
	for _, t := range targets {
		periodKey, start, end, err := currentPeriodKeyAndRange(t.periodType, now)
		if err != nil {
			return nil, err
		}
		effectiveBudget := t.amount
		for _, ov := range overrides[t.id] {
			if ov.periodKey == periodKey {
				effectiveBudget = ov.amount
				break
			}
		}

		sf, ok := byFilterID[strings.ToLower(strings.TrimSpace(t.savedFilterID))]
		if !ok {
			return nil, fmt.Errorf("saved filter %q not found", t.savedFilterID)
		}
		node, err := parseFilterStrict(strings.TrimSpace(sf.Expr))
		if err != nil {
			return nil, fmt.Errorf("parse target filter %q: %w", t.savedFilterID, err)
		}

		ids := accountFilterIDs(accountFilter)
		args := []any{start.Format("2006-01-02"), end.Format("2006-01-02")}
		query := `
			SELECT t.id, t.account_id, t.category_id, COALESCE(c.name, 'Uncategorised'), COALESCE(c.color, '#7f849c'),
			       t.date_iso, t.amount, t.description, t.notes
			FROM transactions t
			LEFT JOIN categories c ON c.id = t.category_id
			WHERE t.date_iso >= ?
			  AND t.date_iso < ?
		`
		if len(ids) > 0 {
			placeholders := make([]string, len(ids))
			for i, id := range ids {
				placeholders[i] = "?"
				args = append(args, id)
			}
			query += " AND t.account_id IN (" + strings.Join(placeholders, ",") + ")"
		}
		rows, err := db.Query(query, args...)
		if err != nil {
			return nil, fmt.Errorf("query target candidates: %w", err)
		}

		spent := 0.0
		offsets := 0.0
		for rows.Next() {
			var txn transaction
			if err := rows.Scan(&txn.id, &txn.accountID, &txn.categoryID, &txn.categoryName, &txn.categoryColor, &txn.dateISO, &txn.amount, &txn.description, &txn.notes); err != nil {
				rows.Close()
				return nil, fmt.Errorf("scan target candidate: %w", err)
			}
			if !evalFilter(node, txn, txnTags[txn.id]) {
				continue
			}
			if txn.amount >= 0 {
				continue
			}
			spent += -txn.amount
			for _, off := range offsetsByDebit[txn.id] {
				offsets += off.amount
			}
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		net := spent - offsets
		remaining := effectiveBudget - net
		lines = append(lines, targetLine{
			targetID:   t.id,
			name:       t.name,
			budgeted:   effectiveBudget,
			spent:      spent,
			offsets:    offsets,
			netSpent:   net,
			remaining:  remaining,
			overBudget: remaining < 0,
			periodType: strings.ToLower(strings.TrimSpace(t.periodType)),
			periodKey:  periodKey,
		})
	}
	return lines, nil
}
