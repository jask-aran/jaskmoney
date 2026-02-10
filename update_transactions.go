package main

import (
	"sort"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

func (m model) updateNavigation(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	return m.updateNavigationWithVisible(msg, m.visibleRows())
}

func (m model) updateNavigationWithVisible(msg tea.KeyMsg, visible int) (tea.Model, tea.Cmd) {
	filtered := m.getFilteredRows()
	m.ensureRangeSelectionValid(filtered)
	keyName := normalizeKeyName(msg.String())
	if visible <= 0 {
		visible = 1
	}

	if m.isAction(scopeTransactions, actionNavigate, msg) {
		nextCursor, _ := m.moveCursorForAction(scopeTransactions, actionNavigate, msg, m.cursor, len(filtered))
		if m.rangeSelecting {
			m.clearRangeSelection()
		}
		m.cursor = nextCursor
		if m.cursor < m.topIndex {
			m.topIndex = m.cursor
		}
		if m.cursor >= m.topIndex+visible {
			m.topIndex = m.cursor - visible + 1
		}
		return m, nil
	}

	switch {
	case m.isAction(scopeTransactions, actionJumpTop, msg):
		if m.rangeSelecting {
			m.clearRangeSelection()
		}
		m.cursor = 0
		m.topIndex = 0
		return m, nil
	case m.isAction(scopeTransactions, actionJumpBottom, msg):
		if m.rangeSelecting {
			m.clearRangeSelection()
		}
		m.cursor = len(filtered) - 1
		if m.cursor < 0 {
			m.cursor = 0
		}
		m.topIndex = m.cursor - visible + 1
		if m.topIndex < 0 {
			m.topIndex = 0
		}
		return m, nil
	}

	if m.isAction(scopeTransactions, actionRangeHighlight, msg) {
		delta := navDeltaFromKeyName(keyName)
		if delta != 0 {
			m.moveCursorWithShift(delta, filtered, visible)
		}
		return m, nil
	}

	switch {
	case m.isAction(scopeTransactions, actionSearch, msg):
		if m.rangeSelecting {
			m.clearRangeSelection()
		}
		m.searchMode = true
		m.searchQuery = ""
		return m, nil
	case m.isAction(scopeTransactions, actionSort, msg):
		if m.rangeSelecting {
			m.clearRangeSelection()
		}
		m.sortColumn = (m.sortColumn + 1) % sortColumnCount
		m.cursor = 0
		m.topIndex = 0
		return m, nil
	case m.isAction(scopeTransactions, actionSortDirection, msg):
		if m.rangeSelecting {
			m.clearRangeSelection()
		}
		m.sortAscending = !m.sortAscending
		m.cursor = 0
		m.topIndex = 0
		return m, nil
	case m.isAction(scopeTransactions, actionFilterCategory, msg):
		if m.rangeSelecting {
			m.clearRangeSelection()
		}
		m.cycleCategoryFilter()
		m.cursor = 0
		m.topIndex = 0
		return m, nil
	case m.isAction(scopeTransactions, actionToggleSelect, msg):
		highlighted := m.highlightedRows(filtered)
		if len(highlighted) > 0 {
			m.toggleSelectionForHighlighted(highlighted, filtered)
		} else {
			m.toggleSelectionAtCursor(filtered)
		}
		return m, nil
	case m.isAction(scopeTransactions, actionQuickCategory, msg):
		return m.openQuickCategoryPicker(filtered)
	case m.isAction(scopeTransactions, actionQuickTag, msg):
		return m.openQuickTagPicker(filtered)
	case m.isAction(scopeTransactions, actionClearSearch, msg):
		if m.rangeSelecting {
			m.clearRangeSelection()
			m.setStatus("Range highlight cleared.")
			return m, nil
		}
		if m.selectedCount() > 0 {
			m.clearSelections()
			m.setStatus("Selection cleared.")
			return m, nil
		}
		if m.searchQuery != "" {
			m.searchQuery = ""
			m.cursor = 0
			m.topIndex = 0
			m.setStatus("Search cleared.")
		}
		return m, nil
	case m.isAction(scopeTransactions, actionSelect, msg):
		if len(filtered) > 0 && m.cursor < len(filtered) {
			m.openDetail(filtered[m.cursor])
		}
		return m, nil
	}
	return m, nil
}

func (m model) openQuickCategoryPicker(filtered []transaction) (tea.Model, tea.Cmd) {
	targetIDs := m.quickCategoryTargets(filtered)
	if len(targetIDs) == 0 {
		m.setStatus("No transaction selected.")
		return m, nil
	}
	if len(m.categories) == 0 {
		m.setStatus("No categories available.")
		return m, nil
	}

	items := make([]pickerItem, 0, len(m.categories))
	for _, c := range m.categories {
		items = append(items, pickerItem{
			ID:    c.id,
			Label: c.name,
			Color: c.color,
		})
	}
	m.catPicker = newPicker("Quick Categorize", items, false, "Create")
	m.catPickerFor = targetIDs
	return m, nil
}

func (m model) quickCategoryTargets(filtered []transaction) []int {
	if len(m.selectedRows) > 0 {
		out := make([]int, 0, len(m.selectedRows))
		for id := range m.selectedRows {
			out = append(out, id)
		}
		sort.Ints(out)
		return out
	}
	if len(filtered) == 0 || m.cursor < 0 || m.cursor >= len(filtered) {
		return nil
	}
	return []int{filtered[m.cursor].id}
}

func (m model) openQuickTagPicker(filtered []transaction) (tea.Model, tea.Cmd) {
	targetIDs := m.quickCategoryTargets(filtered)
	if len(targetIDs) == 0 {
		m.setStatus("No transaction selected.")
		return m, nil
	}

	items := make([]pickerItem, 0, len(m.tags))
	var txnCategoryID *int
	if len(targetIDs) == 1 {
		if txn := m.findTxnByID(targetIDs[0]); txn != nil {
			txnCategoryID = txn.categoryID
		}
	}
	for _, tg := range m.tags {
		section := "Global"
		if tg.categoryID != nil {
			if txnCategoryID != nil && *txnCategoryID == *tg.categoryID {
				section = "Scoped"
			} else {
				section = "Other Scoped"
			}
		}
		items = append(items, pickerItem{
			ID:      tg.id,
			Label:   tg.name,
			Color:   tg.color,
			Section: section,
		})
	}
	m.tagPicker = newPicker("Quick Tags", items, true, "Create")
	m.tagPickerFor = targetIDs
	if len(targetIDs) == 1 {
		for _, tg := range m.txnTags[targetIDs[0]] {
			m.tagPicker.selected[tg.id] = true
		}
	}
	return m, nil
}

func (m model) findTxnByID(id int) *transaction {
	for i := range m.rows {
		if m.rows[i].id == id {
			return &m.rows[i]
		}
	}
	return nil
}

func (m model) updateCatPicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.catPicker == nil {
		return m, nil
	}
	res := m.catPicker.HandleKey(msg.String())
	switch res.Action {
	case pickerActionCancelled:
		m.catPicker = nil
		m.catPickerFor = nil
		m.setStatus("Quick categorize cancelled.")
		return m, nil
	case pickerActionSelected:
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		targetIDs := append([]int(nil), m.catPickerFor...)
		catID := res.ItemID
		catName := res.ItemLabel
		db := m.db
		return m, func() tea.Msg {
			n, err := updateTransactionsCategory(db, targetIDs, &catID)
			return quickCategoryAppliedMsg{count: n, categoryName: catName, created: false, err: err}
		}
	case pickerActionCreate:
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		name := strings.TrimSpace(res.CreatedQuery)
		if name == "" {
			m.setError("Category name cannot be empty.")
			return m, nil
		}
		targetIDs := append([]int(nil), m.catPickerFor...)
		db := m.db
		return m, func() tea.Msg {
			colors := CategoryAccentColors()
			color := "#a6e3a1"
			if len(colors) > 0 {
				color = string(colors[0])
			}

			created := true
			catID, err := insertCategory(db, name, color)
			if err != nil {
				created = false
				existing, lookupErr := loadCategoryByNameCI(db, name)
				if lookupErr != nil {
					return quickCategoryAppliedMsg{err: err}
				}
				if existing == nil {
					return quickCategoryAppliedMsg{err: err}
				}
				catID = existing.id
				name = existing.name
			}

			n, err := updateTransactionsCategory(db, targetIDs, &catID)
			return quickCategoryAppliedMsg{count: n, categoryName: name, created: created, err: err}
		}
	}
	return m, nil
}

func (m model) updateTagPicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.tagPicker == nil {
		return m, nil
	}
	res := m.tagPicker.HandleKey(msg.String())
	switch res.Action {
	case pickerActionCancelled:
		m.tagPicker = nil
		m.tagPickerFor = nil
		m.setStatus("Quick tagging cancelled.")
		return m, nil
	case pickerActionSubmitted:
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		targetIDs := append([]int(nil), m.tagPickerFor...)
		selected := append([]int(nil), res.SelectedIDs...)
		db := m.db
		return m, func() tea.Msg {
			if len(targetIDs) == 1 {
				err := setTransactionTags(db, targetIDs[0], selected)
				return quickTagsAppliedMsg{count: len(targetIDs), err: err}
			}
			_, err := addTagsToTransactions(db, targetIDs, selected)
			return quickTagsAppliedMsg{count: len(targetIDs), err: err}
		}
	case pickerActionCreate:
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		name := strings.TrimSpace(res.CreatedQuery)
		if name == "" {
			m.setError("Tag name cannot be empty.")
			return m, nil
		}
		targetIDs := append([]int(nil), m.tagPickerFor...)
		db := m.db
		return m, func() tea.Msg {
			tagID := 0
			created, err := insertTag(db, name, "", nil)
			if err != nil {
				existing, lookupErr := loadTagByNameCI(db, name)
				if lookupErr != nil {
					return quickTagsAppliedMsg{err: err}
				}
				if existing == nil {
					return quickTagsAppliedMsg{err: err}
				}
				tagID = existing.id
			} else {
				tagID = created
			}
			if len(targetIDs) == 1 {
				current, loadErr := loadTransactionTags(db)
				if loadErr != nil {
					return quickTagsAppliedMsg{err: loadErr}
				}
				desired := []int{tagID}
				for _, tg := range current[targetIDs[0]] {
					if tg.id != tagID {
						desired = append(desired, tg.id)
					}
				}
				return quickTagsAppliedMsg{count: 1, err: setTransactionTags(db, targetIDs[0], desired)}
			}
			_, err = addTagsToTransactions(db, targetIDs, []int{tagID})
			return quickTagsAppliedMsg{count: len(targetIDs), err: err}
		}
	}
	return m, nil
}

func (m *model) selectedCount() int {
	if m == nil || len(m.selectedRows) == 0 {
		return 0
	}
	return len(m.selectedRows)
}

func (m *model) clearSelections() {
	if m == nil {
		return
	}
	m.selectedRows = make(map[int]bool)
	m.selectionAnchor = 0
}

func (m *model) clearRangeSelection() {
	if m == nil {
		return
	}
	m.rangeSelecting = false
	m.rangeAnchorID = 0
	m.rangeCursorID = 0
}

func (m *model) pruneSelections() {
	if m == nil {
		return
	}
	if m.selectedRows == nil {
		m.selectedRows = make(map[int]bool)
	}
	if len(m.selectedRows) == 0 {
		return
	}

	keep := make(map[int]bool, len(m.rows))
	for _, r := range m.rows {
		keep[r.id] = true
	}
	for id := range m.selectedRows {
		if !keep[id] {
			delete(m.selectedRows, id)
		}
	}
	if m.selectionAnchor != 0 && !keep[m.selectionAnchor] {
		m.selectionAnchor = 0
	}
	if m.rangeAnchorID != 0 && !keep[m.rangeAnchorID] {
		m.clearRangeSelection()
	}
	if m.rangeCursorID != 0 && !keep[m.rangeCursorID] {
		m.clearRangeSelection()
	}
}

func (m *model) toggleSelectionAtCursor(filtered []transaction) {
	if m == nil || len(filtered) == 0 || m.cursor < 0 || m.cursor >= len(filtered) {
		return
	}
	if m.selectedRows == nil {
		m.selectedRows = make(map[int]bool)
	}

	id := filtered[m.cursor].id
	if m.selectedRows[id] {
		delete(m.selectedRows, id)
	} else {
		m.selectedRows[id] = true
	}
	m.selectionAnchor = id
}

func indexInFiltered(filtered []transaction, txnID int) int {
	if txnID == 0 {
		return -1
	}
	for i := range filtered {
		if filtered[i].id == txnID {
			return i
		}
	}
	return -1
}

func (m *model) moveCursorWithShift(delta int, filtered []transaction, visible int) {
	if m == nil || len(filtered) == 0 || delta == 0 {
		return
	}
	if !m.rangeSelecting {
		if m.cursor >= 0 && m.cursor < len(filtered) {
			m.rangeAnchorID = filtered[m.cursor].id
			m.rangeCursorID = filtered[m.cursor].id
		}
		m.rangeSelecting = true
	}

	next := m.cursor + delta
	if next < 0 {
		next = 0
	}
	if next > len(filtered)-1 {
		next = len(filtered) - 1
	}
	m.cursor = next
	if visible <= 0 {
		visible = 1
	}
	if m.cursor < m.topIndex {
		m.topIndex = m.cursor
	} else if m.cursor >= m.topIndex+visible {
		m.topIndex = m.cursor - visible + 1
	}
	m.rangeCursorID = filtered[m.cursor].id
}

func (m *model) ensureRangeSelectionValid(filtered []transaction) bool {
	if m == nil || !m.rangeSelecting {
		return false
	}
	if len(filtered) == 0 {
		m.clearRangeSelection()
		return false
	}
	if indexInFiltered(filtered, m.rangeAnchorID) < 0 || indexInFiltered(filtered, m.rangeCursorID) < 0 {
		m.clearRangeSelection()
		return false
	}
	return true
}

func (m model) highlightedRows(filtered []transaction) map[int]bool {
	if !m.rangeSelecting || len(filtered) == 0 {
		return nil
	}
	anchorIdx := indexInFiltered(filtered, m.rangeAnchorID)
	cursorIdx := indexInFiltered(filtered, m.rangeCursorID)
	if anchorIdx < 0 || cursorIdx < 0 {
		return nil
	}
	start := anchorIdx
	end := cursorIdx
	if start > end {
		start, end = end, start
	}
	out := make(map[int]bool, end-start+1)
	for i := start; i <= end; i++ {
		out[filtered[i].id] = true
	}
	return out
}

func (m *model) toggleSelectionForHighlighted(highlighted map[int]bool, filtered []transaction) {
	if m == nil || len(highlighted) == 0 {
		return
	}
	if m.selectedRows == nil {
		m.selectedRows = make(map[int]bool)
	}

	allSelected := true
	for id := range highlighted {
		if !m.selectedRows[id] {
			allSelected = false
			break
		}
	}
	for id := range highlighted {
		if allSelected {
			delete(m.selectedRows, id)
		} else {
			m.selectedRows[id] = true
		}
	}
	if m.cursor >= 0 && m.cursor < len(filtered) {
		m.selectionAnchor = filtered[m.cursor].id
	}
}

func (m *model) cycleCategoryFilter() {
	if len(m.categories) == 0 {
		return
	}
	order := make([]int, 0, len(m.categories)+1)
	nameByID := make(map[int]string, len(m.categories)+1)
	for _, c := range m.categories {
		order = append(order, c.id)
		nameByID[c.id] = c.name
	}
	// Sentinel for uncategorised transactions
	order = append(order, 0)
	nameByID[0] = "Uncategorised"

	if m.filterCategories == nil {
		// First press: filter to first category only
		m.filterCategories = map[int]bool{order[0]: true}
		m.setStatus("Filter: " + nameByID[order[0]])
		return
	}
	// Find which single category is selected and advance to next
	for i, id := range order {
		if m.filterCategories[id] {
			next := (i + 1) % (len(order) + 1)
			if next == len(order) {
				// Wrapped around: clear filter
				m.filterCategories = nil
				m.setStatus("Filter: all categories")
				return
			}
			m.filterCategories = map[int]bool{order[next]: true}
			m.setStatus("Filter: " + nameByID[order[next]])
			return
		}
	}
	// Shouldn't reach here, reset
	m.filterCategories = nil
	m.setStatus("Filter: all categories")
}
