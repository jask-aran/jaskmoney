package app

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"jaskmoney-v2/core"
	coredb "jaskmoney-v2/core/db"
)

type quickCategoryModal struct {
	dbConn *sql.DB
	txnIDs []int
	picker *core.Picker
	byID   map[string]coredb.Category
	errMsg string
}

func newQuickCategoryModal(dbConn *sql.DB, txnIDs []int) core.Screen {
	s := &quickCategoryModal{
		dbConn: dbConn,
		txnIDs: append([]int(nil), txnIDs...),
		byID:   map[string]coredb.Category{},
	}
	if dbConn == nil {
		s.errMsg = "Database not ready."
		return s
	}
	if len(txnIDs) == 0 {
		s.errMsg = "No transaction selected."
		return s
	}
	cats, err := coredb.GetCategories(dbConn)
	if err != nil {
		s.errMsg = "Load categories failed: " + err.Error()
		return s
	}
	items := make([]core.PickerItem, 0, len(cats))
	for _, cat := range cats {
		id := strconv.Itoa(cat.ID)
		s.byID[id] = cat
		items = append(items, core.PickerItem{
			ID:     id,
			Label:  cat.Name,
			Search: cat.Name,
		})
	}
	s.picker = core.NewPicker("Quick Categorize", items)
	if len(items) == 0 {
		s.errMsg = "No categories available."
	}
	return s
}

func (s *quickCategoryModal) Title() string { return "Quick Categorize" }

func (s *quickCategoryModal) Scope() string { return "screen:quick-category" }

func (s *quickCategoryModal) Update(msg tea.Msg) (core.Screen, tea.Cmd, bool) {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok {
		return s, nil, false
	}
	key := normalizePickerKey(keyMsg.String())
	if key == "esc" {
		return s, nil, true
	}
	if s.errMsg != "" || s.picker == nil {
		if key == "enter" {
			return s, nil, true
		}
		return s, nil, false
	}

	res := s.picker.HandleKey(key)
	switch res.Action {
	case core.PickerActionCancelled:
		return s, nil, true
	case core.PickerActionSelected:
		catID, err := strconv.Atoi(strings.TrimSpace(res.Item.ID))
		if err != nil {
			return s, func() tea.Msg {
				return core.StatusMsg{Text: "Invalid category selection.", IsErr: true}
			}, true
		}
		count, err := updateTransactionsCategory(s.dbConn, s.txnIDs, catID)
		if err != nil {
			return s, func() tea.Msg {
				return core.StatusMsg{Text: "Quick categorize failed: " + err.Error(), IsErr: true}
			}, true
		}
		label := strings.TrimSpace(res.Item.Label)
		if label == "" {
			label = "category"
		}
		return s, core.StatusCmd(fmt.Sprintf("Quick categorize: %d txn(s) -> %s", count, label)), true
	default:
		return s, nil, false
	}
}

func (s *quickCategoryModal) View(width, height int) string {
	lines := make([]string, 0, 16)
	lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true).Render("Quick Categorize"))
	if s.errMsg != "" {
		lines = append(lines,
			lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8")).Render(s.errMsg),
			"",
			lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("esc close"),
		)
		return core.ClipHeight(strings.Join(lines, "\n"), core.MaxInt(6, height))
	}

	query := strings.TrimSpace(s.picker.Query())
	if query == "" {
		query = "(type to filter)"
	}
	lines = append(lines, taxLabelStyle("Filter: ")+taxValueStyle(query), "")
	items := s.picker.Items()
	if len(items) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("  No categories"))
	} else {
		for i, item := range items {
			prefix := "  "
			if i == s.picker.Cursor() {
				prefix = lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true).Render("> ")
			}
			cat := s.byID[item.ID]
			swatch := lipgloss.NewStyle().Foreground(lipgloss.Color(cat.Color)).Render("■")
			label := lipgloss.NewStyle().Foreground(lipgloss.Color("#cdd6f4")).Render(item.Label)
			lines = append(lines, prefix+swatch+" "+label)
		}
	}
	lines = append(lines, "", lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("j/k move  enter apply  esc cancel"))
	return core.ClipHeight(strings.Join(lines, "\n"), core.MaxInt(6, height))
}

type quickTagModal struct {
	dbConn *sql.DB
	txnIDs []int
	picker *core.Picker
	errMsg string
}

func newQuickTagModal(dbConn *sql.DB, txnIDs []int) core.Screen {
	s := &quickTagModal{
		dbConn: dbConn,
		txnIDs: append([]int(nil), txnIDs...),
	}
	if dbConn == nil {
		s.errMsg = "Database not ready."
		return s
	}
	if len(txnIDs) == 0 {
		s.errMsg = "No transaction selected."
		return s
	}
	targetCategoryIDs, err := loadTxnCategoryIDSet(dbConn, txnIDs)
	if err != nil {
		s.errMsg = "Load target categories failed: " + err.Error()
		return s
	}
	tags, err := coredb.GetTags(dbConn)
	if err != nil {
		s.errMsg = "Load tags failed: " + err.Error()
		return s
	}

	scopedItems := make([]core.PickerItem, 0, len(tags))
	globalItems := make([]core.PickerItem, 0, len(tags))
	unscopedItems := make([]core.PickerItem, 0, len(tags))
	for _, tg := range tags {
		item := core.PickerItem{
			ID:     strconv.Itoa(tg.ID),
			Label:  tg.Name,
			Search: tg.Name,
		}
		if tg.ScopeID.Valid {
			scopeID := int(tg.ScopeID.Int64)
			if targetCategoryIDs[scopeID] {
				item.Section = "Scoped"
				scopedItems = append(scopedItems, item)
			} else {
				item.Section = "Unscoped"
				unscopedItems = append(unscopedItems, item)
			}
			continue
		}
		item.Section = "Global"
		globalItems = append(globalItems, item)
	}

	items := make([]core.PickerItem, 0, len(tags))
	items = append(items, scopedItems...)
	items = append(items, globalItems...)
	items = append(items, unscopedItems...)

	s.picker = core.NewPicker("Quick Tags", items)
	s.picker.SetMultiSelect(true)
	s.picker.SetCreateLabel("Create")

	hits, err := loadTagHitCount(dbConn, txnIDs)
	if err != nil {
		s.errMsg = "Load tag coverage failed: " + err.Error()
		return s
	}
	states := make(map[string]core.PickerCheckState, len(items))
	for _, item := range items {
		tagID, convErr := strconv.Atoi(strings.TrimSpace(item.ID))
		if convErr != nil {
			continue
		}
		count := hits[tagID]
		switch {
		case count == 0:
			states[item.ID] = core.PickerCheckStateNone
		case count == len(txnIDs):
			states[item.ID] = core.PickerCheckStateAll
		default:
			states[item.ID] = core.PickerCheckStateSome
		}
	}
	s.picker.SetTriState(states)
	return s
}

func (s *quickTagModal) Title() string { return "Quick Tags" }

func (s *quickTagModal) Scope() string { return "screen:quick-tag" }

func (s *quickTagModal) Update(msg tea.Msg) (core.Screen, tea.Cmd, bool) {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok {
		return s, nil, false
	}
	key := normalizePickerKey(keyMsg.String())
	if key == "esc" {
		return s, nil, true
	}
	if s.errMsg != "" || s.picker == nil {
		if key == "enter" {
			return s, nil, true
		}
		return s, nil, false
	}

	if key == "enter" {
		row := s.picker.CurrentRow()
		if row.HasItem && !row.IsCreate && !s.picker.HasPendingChanges() {
			s.picker.Toggle()
			cmd := s.applyPendingChanges(row.Item.Label)
			return s, cmd, true
		}
	}

	res := s.picker.HandleKey(key)
	switch res.Action {
	case core.PickerActionCancelled:
		return s, nil, true
	case core.PickerActionSubmitted:
		cmd := s.applyPendingChanges("")
		return s, cmd, true
	case core.PickerActionCreate:
		cmd, closeNow := s.createAndApply(res.CreatedQuery)
		return s, cmd, closeNow
	default:
		return s, nil, false
	}
}

func (s *quickTagModal) View(width, height int) string {
	lines := make([]string, 0, 20)
	lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true).Render("Quick Tags"))
	if s.errMsg != "" {
		lines = append(lines,
			lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8")).Render(s.errMsg),
			"",
			lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("esc close"),
		)
		return core.ClipHeight(strings.Join(lines, "\n"), core.MaxInt(6, height))
	}

	query := strings.TrimSpace(s.picker.Query())
	if query == "" {
		query = "(type to filter)"
	}
	lines = append(lines, taxLabelStyle("Filter: ")+taxValueStyle(query), "")

	items := s.picker.Items()
	if len(items) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("  No tags. Type to create."))
	} else {
		orderedSections := s.picker.SectionOrder()
		bySection := make(map[string][]core.PickerItem)
		for _, item := range items {
			bySection[item.Section] = append(bySection[item.Section], item)
		}

		cursorIdx := 0
		for _, section := range orderedSections {
			rows := bySection[section]
			if len(rows) == 0 {
				continue
			}
			if strings.TrimSpace(section) != "" {
				lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#a6adc8")).Bold(true).Render(section+":"))
			}
			for _, item := range rows {
				prefix := "  "
				if cursorIdx == s.picker.Cursor() {
					prefix = lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true).Render("> ")
				}
				check := "[ ]"
				switch s.picker.StateForID(item.ID) {
				case core.PickerCheckStateAll:
					check = "[x]"
				case core.PickerCheckStateSome:
					check = "[-]"
				}
				label := lipgloss.NewStyle().Foreground(lipgloss.Color("#cdd6f4")).Render(item.Label)
				lines = append(lines, prefix+check+" "+label)
				cursorIdx++
			}
		}

		if s.picker.ShouldShowCreate() {
			prefix := "    "
			if cursorIdx == s.picker.Cursor() {
				prefix = lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true).Render(">   ")
			}
			createLabel := lipgloss.NewStyle().Foreground(lipgloss.Color("#fab387")).Render("Create \"" + strings.TrimSpace(s.picker.Query()) + "\"")
			lines = append(lines, prefix+createLabel)
		}
	}

	lines = append(lines, "", lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("j/k move  space toggle  enter apply  esc cancel"))
	return core.ClipHeight(strings.Join(lines, "\n"), core.MaxInt(6, height))
}

func (s *quickTagModal) applyPendingChanges(contextLabel string) tea.Cmd {
	addIDs, removeIDs := s.picker.PendingPatch()
	if len(addIDs) == 0 && len(removeIDs) == 0 {
		return core.StatusCmd("Quick tag: no changes.")
	}

	addTagIDs, err := parsePickerIDs(addIDs)
	if err != nil {
		return core.ErrorCmd(fmt.Errorf("invalid tag patch: %w", err))
	}
	removeTagIDs, err := parsePickerIDs(removeIDs)
	if err != nil {
		return core.ErrorCmd(fmt.Errorf("invalid tag patch: %w", err))
	}

	if len(addTagIDs) > 0 {
		if _, err := addTagsToTransactions(s.dbConn, s.txnIDs, addTagIDs); err != nil {
			return core.ErrorCmd(fmt.Errorf("quick tag apply failed: %w", err))
		}
	}
	for _, tagID := range removeTagIDs {
		if _, err := removeTagFromTransactions(s.dbConn, s.txnIDs, tagID); err != nil {
			return core.ErrorCmd(fmt.Errorf("quick tag remove failed: %w", err))
		}
	}

	if strings.TrimSpace(contextLabel) != "" && len(addTagIDs)+len(removeTagIDs) == 1 {
		verb := "updated"
		if len(addTagIDs) == 1 {
			verb = "added"
		}
		if len(removeTagIDs) == 1 {
			verb = "removed"
		}
		return core.StatusCmd(fmt.Sprintf("Quick tag: %s %s on %d txn(s)", verb, contextLabel, len(s.txnIDs)))
	}
	return core.StatusCmd(fmt.Sprintf("Quick tags updated for %d txn(s)", len(s.txnIDs)))
}

func (s *quickTagModal) createAndApply(query string) (tea.Cmd, bool) {
	name := strings.TrimSpace(query)
	if name == "" {
		return core.ErrorCmd(fmt.Errorf("tag name cannot be empty")), false
	}
	tagID, created, err := ensureTagByNameCI(s.dbConn, name)
	if err != nil {
		return core.ErrorCmd(fmt.Errorf("create tag failed: %w", err)), false
	}
	if _, err := addTagsToTransactions(s.dbConn, s.txnIDs, []int{tagID}); err != nil {
		return core.ErrorCmd(fmt.Errorf("apply created tag failed: %w", err)), false
	}
	if created {
		return core.StatusCmd(fmt.Sprintf("Created and applied tag %q to %d txn(s)", name, len(s.txnIDs))), true
	}
	return core.StatusCmd(fmt.Sprintf("Applied existing tag %q to %d txn(s)", name, len(s.txnIDs))), true
}

func normalizePickerKey(v string) string {
	return strings.ToLower(strings.TrimSpace(v))
}

func parsePickerIDs(ids []string) ([]int, error) {
	out := make([]int, 0, len(ids))
	for _, raw := range ids {
		id, err := strconv.Atoi(strings.TrimSpace(raw))
		if err != nil {
			return nil, err
		}
		if id <= 0 {
			continue
		}
		out = append(out, id)
	}
	return out, nil
}

func updateTransactionsCategory(dbConn *sql.DB, txnIDs []int, categoryID int) (int, error) {
	if dbConn == nil {
		return 0, fmt.Errorf("database not ready")
	}
	if len(txnIDs) == 0 {
		return 0, nil
	}
	placeholders, args := intInClause(txnIDs)
	args = append([]any{categoryID}, args...)
	res, err := dbConn.Exec(`UPDATE transactions SET category_id = ? WHERE id IN (`+placeholders+`)`, args...)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func addTagsToTransactions(dbConn *sql.DB, txnIDs []int, tagIDs []int) (int, error) {
	if dbConn == nil {
		return 0, fmt.Errorf("database not ready")
	}
	if len(txnIDs) == 0 || len(tagIDs) == 0 {
		return 0, nil
	}
	tx, err := dbConn.Begin()
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	stmt, err := tx.Prepare(`INSERT OR IGNORE INTO transaction_tags(transaction_id, tag_id) VALUES(?, ?)`)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()

	affected := 0
	for _, txnID := range txnIDs {
		for _, tagID := range tagIDs {
			res, execErr := stmt.Exec(txnID, tagID)
			if execErr != nil {
				return 0, execErr
			}
			n, _ := res.RowsAffected()
			affected += int(n)
		}
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return affected, nil
}

func removeTagFromTransactions(dbConn *sql.DB, txnIDs []int, tagID int) (int, error) {
	if dbConn == nil {
		return 0, fmt.Errorf("database not ready")
	}
	if len(txnIDs) == 0 {
		return 0, nil
	}
	placeholders, args := intInClause(txnIDs)
	args = append([]any{tagID}, args...)
	res, err := dbConn.Exec(`DELETE FROM transaction_tags WHERE tag_id = ? AND transaction_id IN (`+placeholders+`)`, args...)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return int(n), nil
}

func ensureTagByNameCI(dbConn *sql.DB, name string) (int, bool, error) {
	if dbConn == nil {
		return 0, false, fmt.Errorf("database not ready")
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return 0, false, fmt.Errorf("name cannot be empty")
	}
	res, err := dbConn.Exec(`INSERT INTO tags(name, scope_id) VALUES(?, NULL)`, name)
	if err == nil {
		id, idErr := res.LastInsertId()
		if idErr != nil {
			return 0, true, idErr
		}
		return int(id), true, nil
	}
	var existingID int
	if scanErr := dbConn.QueryRow(`SELECT id FROM tags WHERE lower(name) = lower(?) LIMIT 1`, name).Scan(&existingID); scanErr == nil {
		return existingID, false, nil
	}
	return 0, false, err
}

func loadTxnCategoryIDSet(dbConn *sql.DB, txnIDs []int) (map[int]bool, error) {
	out := map[int]bool{}
	if dbConn == nil || len(txnIDs) == 0 {
		return out, nil
	}
	placeholders, args := intInClause(txnIDs)
	rows, err := dbConn.Query(`SELECT category_id FROM transactions WHERE id IN (`+placeholders+`)`, args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var categoryID sql.NullInt64
		if err := rows.Scan(&categoryID); err != nil {
			return out, err
		}
		if categoryID.Valid {
			out[int(categoryID.Int64)] = true
		}
	}
	return out, rows.Err()
}

func loadTagHitCount(dbConn *sql.DB, txnIDs []int) (map[int]int, error) {
	out := map[int]int{}
	if dbConn == nil || len(txnIDs) == 0 {
		return out, nil
	}
	placeholders, args := intInClause(txnIDs)
	rows, err := dbConn.Query(
		`SELECT tag_id, COUNT(DISTINCT transaction_id) FROM transaction_tags WHERE transaction_id IN (`+placeholders+`) GROUP BY tag_id`,
		args...,
	)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var tagID, count int
		if err := rows.Scan(&tagID, &count); err != nil {
			return out, err
		}
		out[tagID] = count
	}
	return out, rows.Err()
}

func intInClause(ids []int) (string, []any) {
	placeholders := make([]string, 0, len(ids))
	args := make([]any, 0, len(ids))
	for _, id := range ids {
		if id <= 0 {
			continue
		}
		placeholders = append(placeholders, "?")
		args = append(args, id)
	}
	if len(placeholders) == 0 {
		return "?", []any{-1}
	}
	return strings.Join(placeholders, ","), args
}
