package db

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"

	"jaskmoney-v2/core/filtering"
)

type RuleRunSample struct {
	TransactionID   int
	DateISO         string
	Amount          float64
	Description     string
	CurrentCategory string
	NewCategory     string
	AddedTagNames   []string
}

type RuleRunOutcome struct {
	RuleID          int
	RuleName        string
	FilterID        string
	FilterExpr      string
	FilterName      string
	Error           string
	Matched         int
	CategoryChanges int
	TagChanges      int
	Samples         []RuleRunSample
}

type RuleRunSummary struct {
	TransactionsScoped   int
	TotalModified        int
	TotalCategoryChanges int
	TotalTagChanges      int
	FailedRules          int
}

func DryRunRulesV2Scoped(db *sql.DB, accountIDs []int) ([]RuleRunOutcome, RuleRunSummary, error) {
	return runRulesV2Scoped(db, accountIDs, true)
}

func ApplyRulesV2Scoped(db *sql.DB, accountIDs []int) (RuleRunSummary, error) {
	_, summary, err := runRulesV2Scoped(db, accountIDs, false)
	return summary, err
}

type resolvedRuleRun struct {
	rule         RuleV2
	node         *filtering.Node
	filterExpr   string
	filterName   string
	addTagIDs    []int
	outcomeIndex int
}

type txnRuleFinalState struct {
	transactionID int
	setCategory   sql.NullInt64
	addTagIDs     []int
}

func runRulesV2Scoped(db *sql.DB, accountIDs []int, dryRun bool) ([]RuleRunOutcome, RuleRunSummary, error) {
	if db == nil {
		return nil, RuleRunSummary{}, fmt.Errorf("database is nil")
	}
	rules, err := LoadRulesV2(db)
	if err != nil {
		return nil, RuleRunSummary{}, err
	}
	savedFilters, err := LoadSavedFilters(db)
	if err != nil {
		return nil, RuleRunSummary{}, err
	}
	filterByID := make(map[string]SavedFilter, len(savedFilters))
	for _, sf := range savedFilters {
		filterByID[strings.ToLower(strings.TrimSpace(sf.ID))] = sf
	}

	outcomes := make([]RuleRunOutcome, 0, len(rules))
	resolved := make([]resolvedRuleRun, 0, len(rules))
	summary := RuleRunSummary{}
	for _, rule := range rules {
		if !rule.Enabled {
			continue
		}
		outcome := RuleRunOutcome{
			RuleID:   rule.ID,
			RuleName: rule.Name,
			FilterID: rule.SavedFilter,
		}
		outcomeIndex := len(outcomes)
		outcomes = append(outcomes, outcome)

		sf, ok := filterByID[strings.ToLower(strings.TrimSpace(rule.SavedFilter))]
		if !ok {
			outcomes[outcomeIndex].Error = "saved filter not found: " + strings.TrimSpace(rule.SavedFilter)
			summary.FailedRules++
			continue
		}
		parsed, parseErr := filtering.ParseStrict(strings.TrimSpace(sf.Expr))
		if parseErr != nil {
			outcomes[outcomeIndex].Error = "saved filter invalid: " + parseErr.Error()
			summary.FailedRules++
			continue
		}
		if !filtering.ContainsFieldPredicate(parsed) {
			parsed = filtering.MarkTextMetadata(parsed)
		}
		tagIDs, tagErr := ParseRuleTagIDs(rule.AddTagIDsRaw)
		if tagErr != nil {
			outcomes[outcomeIndex].Error = "invalid add_tag_ids: " + tagErr.Error()
			summary.FailedRules++
			continue
		}
		outcomes[outcomeIndex].FilterExpr = filtering.String(parsed)
		outcomes[outcomeIndex].FilterName = strings.TrimSpace(sf.Name)
		resolved = append(resolved, resolvedRuleRun{
			rule:         rule,
			node:         parsed,
			filterExpr:   filtering.String(parsed),
			filterName:   strings.TrimSpace(sf.Name),
			addTagIDs:    tagIDs,
			outcomeIndex: outcomeIndex,
		})
	}

	if len(resolved) == 0 {
		return outcomes, summary, nil
	}

	rows, err := QueryTransactionsJoined(db, "", "", accountIDs)
	if err != nil {
		return outcomes, RuleRunSummary{}, err
	}
	summary.TransactionsScoped = len(rows)
	if len(rows) == 0 {
		return outcomes, summary, nil
	}

	categories, err := GetCategories(db)
	if err != nil {
		return outcomes, RuleRunSummary{}, err
	}
	categoryNames := make(map[int]string, len(categories))
	for _, category := range categories {
		categoryNames[category.ID] = category.Name
	}
	tags, err := GetTags(db)
	if err != nil {
		return outcomes, RuleRunSummary{}, err
	}
	tagNamesByID := make(map[int]string, len(tags))
	for _, tag := range tags {
		tagNamesByID[tag.ID] = strings.TrimSpace(tag.Name)
	}

	txnIDs := make([]int, 0, len(rows))
	for _, row := range rows {
		txnIDs = append(txnIDs, row.ID)
	}
	txnTagSets, err := loadTransactionTagIDSets(db, txnIDs)
	if err != nil {
		return outcomes, RuleRunSummary{}, err
	}

	finalStates := make([]txnRuleFinalState, 0, len(rows))
	for _, row := range rows {
		currentCategory := row.CategoryID
		currentTags := cloneTagSet(txnTagSets[row.ID])
		workCategory := currentCategory
		workTags := cloneTagSet(currentTags)

		for _, resolvedRule := range resolved {
			filterRow := filtering.Row{
				Description:  row.Description,
				CategoryName: ruleCategoryName(workCategory, categoryNames),
				Notes:        row.Notes,
				AccountName:  row.AccountName,
				DateISO:      row.DateISO,
				Amount:       row.Amount,
				TagNames:     sortedTagNames(workTags, tagNamesByID),
			}
			if !filtering.Eval(resolvedRule.node, filterRow) {
				continue
			}

			outcome := &outcomes[resolvedRule.outcomeIndex]
			outcome.Matched++
			beforeCategory := workCategory
			beforeTags := cloneTagSet(workTags)

			if resolvedRule.rule.SetCategory.Valid {
				workCategory = sql.NullInt64{Int64: resolvedRule.rule.SetCategory.Int64, Valid: true}
			}
			for _, tagID := range resolvedRule.addTagIDs {
				if tagID > 0 {
					workTags[tagID] = true
				}
			}

			categoryChanged := !ruleNullIntEqual(beforeCategory, workCategory)
			addedIDs := addedTagIDs(beforeTags, workTags)
			if categoryChanged {
				outcome.CategoryChanges++
			}
			outcome.TagChanges += len(addedIDs)

			if len(outcome.Samples) < 3 && (categoryChanged || len(addedIDs) > 0) {
				outcome.Samples = append(outcome.Samples, RuleRunSample{
					TransactionID:   row.ID,
					DateISO:         row.DateISO,
					Amount:          row.Amount,
					Description:     row.Description,
					CurrentCategory: ruleCategoryName(beforeCategory, categoryNames),
					NewCategory:     ruleCategoryName(workCategory, categoryNames),
					AddedTagNames:   tagNamesForIDs(addedIDs, tagNamesByID),
				})
			}
		}

		addedFinal := addedTagIDs(currentTags, workTags)
		categoryChanged := !ruleNullIntEqual(currentCategory, workCategory)
		if categoryChanged || len(addedFinal) > 0 {
			summary.TotalModified++
		}
		if categoryChanged {
			summary.TotalCategoryChanges++
		}
		summary.TotalTagChanges += len(addedFinal)
		finalStates = append(finalStates, txnRuleFinalState{
			transactionID: row.ID,
			setCategory:   workCategory,
			addTagIDs:     addedFinal,
		})
	}

	if dryRun {
		return outcomes, summary, nil
	}
	if err := applyRuleFinalStates(db, rows, finalStates); err != nil {
		return outcomes, RuleRunSummary{}, err
	}
	return outcomes, summary, nil
}

func applyRuleFinalStates(db *sql.DB, rows []TransactionJoined, states []txnRuleFinalState) error {
	stateByTxnID := make(map[int]txnRuleFinalState, len(states))
	for _, state := range states {
		stateByTxnID[state.transactionID] = state
	}
	rowByID := make(map[int]TransactionJoined, len(rows))
	for _, row := range rows {
		rowByID[row.ID] = row
	}

	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	updateStmt, err := tx.Prepare(`UPDATE transactions SET category_id = ? WHERE id = ?`)
	if err != nil {
		return err
	}
	defer updateStmt.Close()

	insertTagStmt, err := tx.Prepare(`INSERT OR IGNORE INTO transaction_tags(transaction_id, tag_id) VALUES(?, ?)`)
	if err != nil {
		return err
	}
	defer insertTagStmt.Close()

	for txnID, state := range stateByTxnID {
		row, exists := rowByID[txnID]
		if !exists {
			continue
		}
		if !ruleNullIntEqual(row.CategoryID, state.setCategory) {
			if _, err := updateStmt.Exec(nullableInt64(state.setCategory), txnID); err != nil {
				return err
			}
		}
		for _, tagID := range state.addTagIDs {
			if tagID <= 0 {
				continue
			}
			if _, err := insertTagStmt.Exec(txnID, tagID); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}

func loadTransactionTagIDSets(db *sql.DB, txnIDs []int) (map[int]map[int]bool, error) {
	out := make(map[int]map[int]bool, len(txnIDs))
	placeholders, args := intSliceClause(txnIDs)
	if placeholders == "" {
		return out, nil
	}
	rows, err := db.Query(`
		SELECT transaction_id, tag_id
		FROM transaction_tags
		WHERE transaction_id IN (`+placeholders+`)
		ORDER BY transaction_id, tag_id
	`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var txnID int
		var tagID int
		if err := rows.Scan(&txnID, &tagID); err != nil {
			return nil, err
		}
		set := out[txnID]
		if set == nil {
			set = map[int]bool{}
			out[txnID] = set
		}
		set[tagID] = true
	}
	return out, rows.Err()
}

func cloneTagSet(in map[int]bool) map[int]bool {
	if len(in) == 0 {
		return map[int]bool{}
	}
	out := make(map[int]bool, len(in))
	for id, on := range in {
		if on {
			out[id] = true
		}
	}
	return out
}

func addedTagIDs(before, after map[int]bool) []int {
	if len(after) == 0 {
		return nil
	}
	ids := make([]int, 0, len(after))
	for id, on := range after {
		if !on || before[id] {
			continue
		}
		ids = append(ids, id)
	}
	sort.Ints(ids)
	return ids
}

func sortedTagNames(set map[int]bool, names map[int]string) []string {
	if len(set) == 0 {
		return nil
	}
	ids := make([]int, 0, len(set))
	for id, on := range set {
		if on {
			ids = append(ids, id)
		}
	}
	sort.Ints(ids)
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		name := strings.TrimSpace(names[id])
		if name == "" {
			name = fmt.Sprintf("tag#%d", id)
		}
		out = append(out, name)
	}
	return out
}

func tagNamesForIDs(ids []int, names map[int]string) []string {
	if len(ids) == 0 {
		return nil
	}
	out := make([]string, 0, len(ids))
	for _, id := range ids {
		name := strings.TrimSpace(names[id])
		if name == "" {
			name = fmt.Sprintf("tag#%d", id)
		}
		out = append(out, name)
	}
	return out
}

func ruleNullIntEqual(a, b sql.NullInt64) bool {
	if a.Valid != b.Valid {
		return false
	}
	if !a.Valid {
		return true
	}
	return a.Int64 == b.Int64
}

func ruleCategoryName(v sql.NullInt64, names map[int]string) string {
	if !v.Valid {
		return "Uncategorised"
	}
	name := strings.TrimSpace(names[int(v.Int64)])
	if name == "" {
		return fmt.Sprintf("Category %d", v.Int64)
	}
	return name
}
