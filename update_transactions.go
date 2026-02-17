package main

import (
	"database/sql"
	"fmt"
	"sort"
	"strconv"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
)

func (m model) updateNavigation(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	return m.updateNavigationWithVisible(msg, m.visibleRows())
}

func (m model) updateNavigationWithVisible(msg tea.KeyMsg, visible int) (tea.Model, tea.Cmd) {
	filtered := m.getFilteredRows()
	m.ensureRangeSelectionValid(filtered)
	if visible <= 0 {
		visible = 1
	}

	if delta := m.verticalDelta(scopeTransactions, msg); delta != 0 {
		nextCursor := moveBoundedCursor(m.cursor, len(filtered), delta)
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

	if m.isAction(scopeTransactions, actionRangeHighlight, msg) {
		delta := navDeltaFromKeyName(normalizeKeyName(msg.String()))
		if delta != 0 {
			m.moveCursorWithShift(delta, filtered, visible)
		}
		return m, nil
	}

	if next, cmd, handled := m.executeBoundCommand(scopeTransactions, msg); handled {
		return next, cmd
	}
	return m, nil
}

func (m model) openQuickCategoryPicker(filtered []transaction) (tea.Model, tea.Cmd) {
	targetIDs := m.quickActionTargets(filtered)
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
	m.catPicker = newPicker("Quick Categorize", items, false, "")
	m.catPicker.cursorOnly = true
	m.catPickerFor = targetIDs
	return m, nil
}

func (m model) quickActionTargets(filtered []transaction) []int {
	highlighted := m.highlightedRows(filtered)
	if len(highlighted) > 0 {
		out := make([]int, 0, len(highlighted))
		for id := range highlighted {
			out = append(out, id)
		}
		sort.Ints(out)
		return out
	}
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
	targetIDs := m.quickActionTargets(filtered)
	if len(targetIDs) == 0 {
		m.setStatus("No transaction selected.")
		return m, nil
	}

	items := make([]pickerItem, 0, len(m.tags))
	targetCategoryIDs := make(map[int]bool)
	for _, txnID := range targetIDs {
		if txn := m.findTxnByID(txnID); txn != nil && txn.categoryID != nil {
			targetCategoryIDs[*txn.categoryID] = true
		}
	}
	scopedItems := make([]pickerItem, 0, len(m.tags))
	globalItems := make([]pickerItem, 0, len(m.tags))
	unscopedItems := make([]pickerItem, 0, len(m.tags))
	for _, tg := range m.tags {
		section := "Global"
		if tg.categoryID != nil {
			if targetCategoryIDs[*tg.categoryID] {
				section = "Scoped"
			} else {
				section = "Unscoped"
			}
		}
		item := pickerItem{
			ID:      tg.id,
			Label:   tg.name,
			Color:   tg.color,
			Section: section,
		}
		switch section {
		case "Scoped":
			scopedItems = append(scopedItems, item)
		case "Global":
			globalItems = append(globalItems, item)
		default:
			unscopedItems = append(unscopedItems, item)
		}
	}
	items = append(items, scopedItems...)
	items = append(items, globalItems...)
	items = append(items, unscopedItems...)
	m.tagPicker = newPicker("Quick Tags", items, true, "Create")
	m.tagPicker.cursorOnly = true
	m.tagPickerFor = targetIDs
	stateByTagID := make(map[int]pickerCheckState, len(items))
	hitCount := make(map[int]int)
	for _, txnID := range targetIDs {
		for _, tg := range m.txnTags[txnID] {
			hitCount[tg.id]++
		}
	}
	for _, tg := range m.tags {
		count := hitCount[tg.id]
		switch {
		case count == 0:
			stateByTagID[tg.id] = pickerStateNone
		case count == len(targetIDs):
			stateByTagID[tg.id] = pickerStateAll
		default:
			stateByTagID[tg.id] = pickerStateSome
		}
	}
	m.tagPicker.SetTriState(stateByTagID)
	return m, nil
}

func (m model) openQuickOffsetModal(filtered []transaction) (tea.Model, tea.Cmd) {
	targetIDs := m.quickActionTargets(filtered)
	if len(targetIDs) == 0 {
		m.setStatus("No transaction selected.")
		return m, nil
	}
	for _, txnID := range targetIDs {
		txn := m.findTxnByID(txnID)
		if txn == nil {
			m.setStatus("No transaction selected.")
			return m, nil
		}
		if txn.amount >= 0 {
			m.setStatus("Quick offset applies to debit transactions only.")
			return m, nil
		}
	}
	m.quickOffsetOpen = true
	m.quickOffsetFor = targetIDs
	m.quickOffsetAmount = ""
	m.quickOffsetCursor = 0
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
	res := m.catPicker.HandleMsg(msg, func(action Action, in tea.KeyMsg) bool {
		return m.isAction(scopeCategoryPicker, action, in)
	})
	if m.ruleEditorPickingCategory {
		switch res.Action {
		case pickerActionCancelled:
			m.catPicker = nil
			m.ruleEditorPickingCategory = false
			return m, nil
		case pickerActionSelected:
			if res.ItemID <= 0 {
				m.ruleEditorCatID = nil
			} else {
				catID := res.ItemID
				m.ruleEditorCatID = &catID
			}
			m.catPicker = nil
			m.ruleEditorPickingCategory = false
			m.ruleEditorStep = 3
			m.ruleEditorErr = ""
			return m, nil
		}
		return m, nil
	}
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
		m.setStatus("Create categories from Settings -> Categories.")
		return m, nil
	}
	return m, nil
}

func (m model) updateTagPicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.tagPicker == nil {
		return m, nil
	}
	if m.ruleEditorPickingTags {
		if m.isAction(scopeTagPicker, actionSelect, msg) {
			row := m.tagPicker.currentRow()
			if row.item != nil && !row.isCreate && !m.tagPicker.HasPendingChanges() {
				m.tagPicker.Toggle()
				m.ruleEditorAddTags = m.tagPicker.Selected()
				m.normalizeRuleEditorSelections()
				m.tagPicker = nil
				m.ruleEditorPickingTags = false
				m.ruleEditorStep = 4
				m.ruleEditorErr = ""
				return m, nil
			}
		}
		res := m.tagPicker.HandleMsg(msg, func(action Action, in tea.KeyMsg) bool {
			return m.isAction(scopeTagPicker, action, in)
		})
		switch res.Action {
		case pickerActionCancelled:
			m.tagPicker = nil
			m.ruleEditorPickingTags = false
			return m, nil
		case pickerActionSubmitted:
			m.ruleEditorAddTags = append([]int(nil), res.SelectedIDs...)
			m.normalizeRuleEditorSelections()
			m.tagPicker = nil
			m.ruleEditorPickingTags = false
			m.ruleEditorStep = 4
			m.ruleEditorErr = ""
			return m, nil
		}
		return m, nil
	}
	if m.isAction(scopeTagPicker, actionSelect, msg) {
		row := m.tagPicker.currentRow()
		if row.item != nil && !row.isCreate {
			if m.db == nil {
				m.setError("Database not ready.")
				return m, nil
			}
			targetIDs := append([]int(nil), m.tagPickerFor...)
			tagID := row.item.ID
			tagName := row.item.Label
			db := m.db
			if !m.tagPicker.HasPendingChanges() {
				m.tagPicker.Toggle()
				addIDs, _ := m.tagPicker.PendingTagPatch()
				toggledOn := len(addIDs) > 0
				return m, func() tea.Msg {
					if len(addIDs) > 0 {
						_, err := addTagsToTransactions(db, targetIDs, addIDs)
						return quickTagsAppliedMsg{
							count:     len(targetIDs),
							tagName:   tagName,
							toggled:   true,
							toggledOn: true,
							err:       err,
						}
					}
					_, err := removeTagFromTransactions(db, targetIDs, tagID)
					return quickTagsAppliedMsg{
						count:     len(targetIDs),
						tagName:   tagName,
						toggled:   true,
						toggledOn: toggledOn,
						err:       err,
					}
				}
			}
			addIDs, removeIDs := m.tagPicker.PendingTagPatch()
			return m, func() tea.Msg {
				if len(addIDs) > 0 {
					if _, err := addTagsToTransactions(db, targetIDs, addIDs); err != nil {
						return quickTagsAppliedMsg{err: err}
					}
				}
				for _, removeID := range removeIDs {
					if _, err := removeTagFromTransactions(db, targetIDs, removeID); err != nil {
						return quickTagsAppliedMsg{err: err}
					}
				}
				return quickTagsAppliedMsg{count: len(targetIDs), err: nil}
			}
		}
	}
	res := m.tagPicker.HandleMsg(msg, func(action Action, in tea.KeyMsg) bool {
		return m.isAction(scopeTagPicker, action, in)
	})
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

func (m model) updateQuickOffsetModal(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if !m.quickOffsetOpen {
		return m, nil
	}
	keyName := normalizeKeyName(msg.String())
	switch keyName {
	case "esc":
		m.quickOffsetOpen = false
		m.quickOffsetFor = nil
		m.quickOffsetAmount = ""
		m.quickOffsetCursor = 0
		m.setStatus("Quick offset cancelled.")
		return m, nil
	case "enter":
		if m.db == nil {
			m.setError("Database not ready.")
			return m, nil
		}
		amount, err := strconv.ParseFloat(strings.TrimSpace(m.quickOffsetAmount), 64)
		if err != nil || amount <= 0 {
			m.setError("Invalid offset amount.")
			return m, nil
		}
		targetIDs := append([]int(nil), m.quickOffsetFor...)
		db := m.db
		return m, func() tea.Msg {
			n, applyErr := applyManualOffsets(db, targetIDs, amount)
			return quickOffsetsAppliedMsg{count: n, amount: amount, err: applyErr}
		}
	case "backspace":
		deleteASCIIByteBeforeCursor(&m.quickOffsetAmount, &m.quickOffsetCursor)
		return m, nil
	case "left":
		moveInputCursorASCII(m.quickOffsetAmount, &m.quickOffsetCursor, -1)
		return m, nil
	case "right":
		moveInputCursorASCII(m.quickOffsetAmount, &m.quickOffsetCursor, 1)
		return m, nil
	}
	if isPrintableASCIIKey(msg.String()) {
		insertPrintableASCIIAtCursor(&m.quickOffsetAmount, &m.quickOffsetCursor, msg.String())
	}
	return m, nil
}

func applyManualOffsets(db *sql.DB, txnIDs []int, amount float64) (int, error) {
	targets := make([]int, 0, len(txnIDs))
	seen := make(map[int]bool, len(txnIDs))
	for _, id := range txnIDs {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		targets = append(targets, id)
	}
	if len(targets) == 0 {
		return 0, fmt.Errorf("no transactions selected")
	}
	for _, id := range targets {
		if err := insertManualOffset(db, id, amount); err != nil {
			return 0, err
		}
	}
	return len(targets), nil
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
