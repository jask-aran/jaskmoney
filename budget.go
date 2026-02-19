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

type budgetLine struct {
	categoryID    int
	categoryName  string
	categoryColor string
	budgeted      float64
	spent         float64
	remaining     float64
	overBudget    bool
}

type targetLine struct {
	targetID   int
	name       string
	budgeted   float64
	spent      float64
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

func queryEffectiveSpendByCategory(db *sql.DB, startISO, endISO string, accountFilter map[int]bool) (map[int]float64, error) {
	ids := accountFilterIDs(accountFilter)
	args := []any{startISO, endISO}
	query := `
		WITH scoped_txn AS (
			SELECT id, category_id, amount
			FROM transactions
			WHERE date_iso >= ?
			  AND date_iso < ?
	`
	if len(ids) > 0 {
		placeholders := make([]string, len(ids))
		for i, id := range ids {
			placeholders[i] = "?"
			args = append(args, id)
		}
		query += "  AND account_id IN (" + strings.Join(placeholders, ",") + ")\n"
	}
	query += `
		),
		scoped_alloc AS (
			SELECT a.parent_txn_id, a.category_id, a.amount
			FROM transaction_allocations a
			JOIN scoped_txn s ON s.id = a.parent_txn_id
		),
		alloc_sum AS (
			SELECT parent_txn_id, COALESCE(SUM(amount), 0) AS allocated
			FROM scoped_alloc
			GROUP BY parent_txn_id
		),
		parent_remainder AS (
			SELECT s.category_id, (s.amount - COALESCE(a.allocated, 0)) AS amount
			FROM scoped_txn s
			LEFT JOIN alloc_sum a ON a.parent_txn_id = s.id
		),
		effective_rows AS (
			SELECT category_id, amount FROM scoped_alloc
			UNION ALL
			SELECT category_id, amount FROM parent_remainder
		)
		SELECT category_id, COALESCE(SUM(-amount), 0)
		FROM effective_rows
		WHERE amount < 0
		GROUP BY category_id
	`

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, fmt.Errorf("query budget effective aggregates: %w", err)
	}
	defer rows.Close()

	out := make(map[int]float64)
	for rows.Next() {
		var categoryID sql.NullInt64
		var spent float64
		if err := rows.Scan(&categoryID, &spent); err != nil {
			return nil, fmt.Errorf("scan budget effective aggregate: %w", err)
		}
		if categoryID.Valid {
			out[int(categoryID.Int64)] = spent
		}
	}
	return out, rows.Err()
}

func computeBudgetLines(db *sql.DB, budgets []categoryBudget, overrides map[int][]budgetOverride, month string, accountFilter map[int]bool) ([]budgetLine, error) {
	start, end, err := parseMonthKey(month)
	if err != nil {
		return nil, err
	}

	spendByCategory, err := queryEffectiveSpendByCategory(db, start.Format("2006-01-02"), end.Format("2006-01-02"), accountFilter)
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
		spent := spendByCategory[b.categoryID]
		remaining := effective - spent
		lines = append(lines, budgetLine{
			categoryID:    b.categoryID,
			categoryName:  cat.name,
			categoryColor: cat.color,
			budgeted:      effective,
			spent:         spent,
			remaining:     remaining,
			overBudget:    remaining < 0,
		})
	}
	return lines, nil
}

func computeTargetLines(db *sql.DB, targets []spendingTarget, overrides map[int][]targetOverride, txnTags map[int][]tag, savedFilters []savedFilter, accountFilter map[int]bool) ([]targetLine, error) {
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

		parentRows := make([]transaction, 0)
		for rows.Next() {
			var txn transaction
			if err := rows.Scan(&txn.id, &txn.accountID, &txn.categoryID, &txn.categoryName, &txn.categoryColor, &txn.dateISO, &txn.amount, &txn.description, &txn.notes); err != nil {
				rows.Close()
				return nil, fmt.Errorf("scan target candidate: %w", err)
			}
			parentRows = append(parentRows, txn)
		}
		if err := rows.Close(); err != nil {
			return nil, err
		}
		parentIDs := make([]int, 0, len(parentRows))
		for _, row := range parentRows {
			parentIDs = append(parentIDs, row.id)
		}
		allocationRows, err := loadTransactionAllocationsForParents(db, parentIDs)
		if err != nil {
			return nil, err
		}
		allocByParent, allocByID := indexTransactionAllocations(allocationRows)
		allocationIDs := make([]int, 0, len(allocByID))
		for id := range allocByID {
			allocationIDs = append(allocationIDs, id)
		}
		allocationTags, err := loadTransactionAllocationTagsByAllocationIDs(db, allocationIDs)
		if err != nil {
			return nil, err
		}

		effectiveRows := make([]transaction, 0, len(parentRows)+len(allocationRows))
		effectiveTags := make(map[int][]tag, len(parentRows)+len(allocationRows))
		for _, parent := range parentRows {
			parent.fullAmount = parent.amount
			parent.parentTxnID = parent.id
			allocated := 0.0
			for _, alloc := range allocByParent[parent.id] {
				allocated += alloc.amount
			}
			parent.amount = parent.fullAmount - allocated
			effectiveRows = append(effectiveRows, parent)
			effectiveTags[parent.id] = txnTags[parent.id]

			for _, alloc := range allocByParent[parent.id] {
				child := parent
				child.id = -alloc.id
				child.amount = alloc.amount
				child.fullAmount = 0
				child.isAllocation = true
				child.parentTxnID = parent.id
				child.allocationID = alloc.id
				child.notes = alloc.note
				if strings.TrimSpace(alloc.note) != "" {
					child.description = alloc.note
				} else {
					child.description = "Allocation"
				}
				child.categoryID = copyIntPtr(alloc.categoryID)
				child.categoryName = alloc.categoryName
				child.categoryColor = alloc.categoryColor
				effectiveRows = append(effectiveRows, child)
				effectiveTags[child.id] = allocationTags[alloc.id]
			}
		}

		spent := 0.0
		for _, row := range effectiveRows {
			if !evalFilter(node, row, effectiveTags[row.id]) {
				continue
			}
			if row.amount >= 0 {
				continue
			}
			spent += -row.amount
		}
		remaining := effectiveBudget - spent
		lines = append(lines, targetLine{
			targetID:   t.id,
			name:       t.name,
			budgeted:   effectiveBudget,
			spent:      spent,
			remaining:  remaining,
			overBudget: remaining < 0,
			periodType: strings.ToLower(strings.TrimSpace(t.periodType)),
			periodKey:  periodKey,
		})
	}
	return lines, nil
}
