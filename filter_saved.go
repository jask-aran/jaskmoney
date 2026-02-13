package main

import (
	"fmt"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
)

func slugifySavedFilterID(raw string) string {
	raw = strings.ToLower(strings.TrimSpace(raw))
	if raw == "" {
		return "filter"
	}
	var b strings.Builder
	b.Grow(len(raw))
	lastDash := false
	for i := 0; i < len(raw); i++ {
		ch := raw[i]
		isAlphaNum := (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')
		switch {
		case isAlphaNum:
			b.WriteByte(ch)
			lastDash = false
		case ch == '_' || ch == '-':
			if b.Len() > 0 && !lastDash {
				b.WriteByte(ch)
				lastDash = true
			}
		default:
			if b.Len() > 0 && !lastDash {
				b.WriteByte('-')
				lastDash = true
			}
		}
	}
	id := strings.Trim(b.String(), "-_")
	if id == "" {
		id = "filter"
	}
	if len(id) > 63 {
		id = id[:63]
	}
	if first := id[0]; !((first >= 'a' && first <= 'z') || (first >= '0' && first <= '9')) {
		id = "f-" + id
		if len(id) > 63 {
			id = id[:63]
		}
	}
	return id
}

func nextUniqueSavedFilterID(existing []savedFilter, base string) string {
	candidate := slugifySavedFilterID(base)
	seen := make(map[string]bool, len(existing))
	for _, sf := range existing {
		seen[strings.ToLower(strings.TrimSpace(sf.ID))] = true
	}
	if !seen[candidate] {
		return candidate
	}
	for i := 2; i < 10000; i++ {
		next := fmt.Sprintf("%s-%d", candidate, i)
		if len(next) > 63 {
			over := len(next) - 63
			if over < len(candidate) {
				next = candidate[:len(candidate)-over] + fmt.Sprintf("-%d", i)
			} else {
				next = fmt.Sprintf("f-%d", i)
			}
		}
		if !seen[next] {
			return next
		}
	}
	return candidate
}

func (m model) orderedSavedFilters() []savedFilter {
	out := make([]savedFilter, 0, len(m.savedFilters))
	out = append(out, m.savedFilters...)
	sort.Slice(out, func(i, j int) bool {
		iUsage := m.filterUsage[strings.ToLower(strings.TrimSpace(out[i].ID))]
		jUsage := m.filterUsage[strings.ToLower(strings.TrimSpace(out[j].ID))]
		if iUsage.lastUsedUnix != jUsage.lastUsedUnix {
			return iUsage.lastUsedUnix > jUsage.lastUsedUnix
		}
		iID := strings.ToLower(strings.TrimSpace(out[i].ID))
		jID := strings.ToLower(strings.TrimSpace(out[j].ID))
		if iID != jID {
			return iID < jID
		}
		return strings.ToLower(strings.TrimSpace(out[i].Name)) < strings.ToLower(strings.TrimSpace(out[j].Name))
	})
	return out
}

func (m model) findSavedFilterByID(id string) (savedFilter, bool) {
	normalized, err := normalizeSavedFilterID(id)
	if err != nil {
		return savedFilter{}, false
	}
	for _, sf := range m.savedFilters {
		if strings.EqualFold(strings.TrimSpace(sf.ID), normalized) {
			return sf, true
		}
	}
	return savedFilter{}, false
}

func (m *model) touchSavedFilterUsage(filterID string, incrementUseCount bool) error {
	if m == nil {
		return nil
	}
	id, err := normalizeSavedFilterID(filterID)
	if err != nil {
		return err
	}
	if m.db != nil {
		if err := touchFilterUsageState(m.db, id, incrementUseCount); err != nil {
			return err
		}
	}
	if m.filterUsage == nil {
		m.filterUsage = make(map[string]filterUsageState)
	}
	state := m.filterUsage[id]
	state.filterID = id
	state.lastUsedUnix = time.Now().Unix()
	if incrementUseCount {
		state.useCount++
	}
	m.filterUsage[id] = state
	return nil
}

func (m model) applySavedFilterByID(id string) (model, error) {
	saved, ok := m.findSavedFilterByID(id)
	if !ok {
		return m, fmt.Errorf("unknown saved filter %q", strings.TrimSpace(id))
	}
	return m.applySavedFilter(saved, true)
}

func (m model) applySavedFilter(saved savedFilter, trackUsage bool) (model, error) {
	if m.activeTab == tabManager && m.managerMode == managerModeAccounts {
		m.managerMode = managerModeTransactions
		m.focusedSection = sectionManagerTransactions
	}
	m.filterInput = saved.Expr
	m.reparseFilterInput()
	m.filterInputMode = false
	m.filterInputCursor = len(m.filterInput)
	m.filterLastApplied = saved.Expr
	m.cursor = 0
	m.topIndex = 0
	if trackUsage {
		if err := m.touchSavedFilterUsage(saved.ID, true); err != nil {
			return m, err
		}
	}
	m.setStatusf("Applied saved filter %q.", saved.ID)
	return m, nil
}

func (m *model) openFilterApplyPicker(query string) {
	if m == nil {
		return
	}
	ordered := m.orderedSavedFilters()
	items := make([]pickerItem, 0, len(ordered))
	m.filterApplyOrder = make([]string, 0, len(ordered))
	for i, sf := range ordered {
		meta := strings.TrimSpace(sf.Name)
		if meta == "" {
			meta = truncate(strings.TrimSpace(sf.Expr), 40)
		}
		items = append(items, pickerItem{ID: i + 1, Label: sf.ID, Meta: meta})
		m.filterApplyOrder = append(m.filterApplyOrder, sf.ID)
	}
	p := newPicker("Apply Saved Filter", items, false, "")
	p.cursorOnly = true
	if strings.TrimSpace(query) != "" {
		p.SetQuery(strings.TrimSpace(query))
	}
	m.filterApplyPicker = p
}

func (m model) updateFilterApplyPicker(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if m.filterApplyPicker == nil {
		return m, nil
	}
	res := m.filterApplyPicker.HandleMsg(msg, func(action Action, in tea.KeyMsg) bool {
		return m.isAction(scopeFilterApplyPicker, action, in)
	})
	switch res.Action {
	case pickerActionCancelled:
		m.filterApplyPicker = nil
		m.filterApplyOrder = nil
		m.setStatus("Apply filter cancelled.")
		return m, nil
	case pickerActionSelected:
		id := ""
		idx := res.ItemID - 1
		if idx >= 0 && idx < len(m.filterApplyOrder) {
			id = m.filterApplyOrder[idx]
		}
		if strings.TrimSpace(id) == "" {
			if row := m.filterApplyPicker.currentRow(); row.item != nil {
				id = row.item.Label
			}
		}
		next, err := m.applySavedFilterByID(id)
		next.filterApplyPicker = nil
		next.filterApplyOrder = nil
		if err != nil {
			next.setError(fmt.Sprintf("Apply filter failed: %v", err))
			return next, nil
		}
		return next, nil
	}
	return m, nil
}

func (m *model) openFilterEditor(existing *savedFilter, exprHint string) {
	if m == nil {
		return
	}
	m.filterEditOpen = true
	m.filterEditErr = ""
	m.filterEditFocus = 0
	m.filterEditIDCur = 0
	m.filterEditNameCur = 0
	m.filterEditExprCur = 0
	if existing != nil {
		m.filterEditIsNew = false
		m.filterEditID = strings.TrimSpace(existing.ID)
		m.filterEditOrigID = strings.TrimSpace(existing.ID)
		m.filterEditName = strings.TrimSpace(existing.Name)
		m.filterEditExpr = strings.TrimSpace(existing.Expr)
		m.filterEditIDCur = len(m.filterEditID)
		m.filterEditNameCur = len(m.filterEditName)
		m.filterEditExprCur = len(m.filterEditExpr)
		return
	}
	expr := strings.TrimSpace(exprHint)
	if expr == "" {
		expr = strings.TrimSpace(m.filterInput)
	}
	id := nextUniqueSavedFilterID(m.savedFilters, "filter")
	m.filterEditIsNew = true
	m.filterEditID = id
	m.filterEditOrigID = ""
	m.filterEditName = ""
	m.filterEditExpr = expr
	m.filterEditIDCur = len(m.filterEditID)
	m.filterEditNameCur = 0
	m.filterEditExprCur = len(m.filterEditExpr)
}

func (m *model) closeFilterEditor() {
	if m == nil {
		return
	}
	m.filterEditOpen = false
	m.filterEditErr = ""
	m.filterEditID = ""
	m.filterEditOrigID = ""
	m.filterEditName = ""
	m.filterEditExpr = ""
	m.filterEditIDCur = 0
	m.filterEditNameCur = 0
	m.filterEditExprCur = 0
	m.filterEditFocus = 0
	m.filterEditIsNew = false
}

func (m model) saveFilterEditor() (model, error) {
	id, err := normalizeSavedFilterID(m.filterEditID)
	if err != nil {
		return m, err
	}
	name := strings.TrimSpace(m.filterEditName)
	if name == "" {
		return m, fmt.Errorf("name is required")
	}
	expr := strings.TrimSpace(m.filterEditExpr)
	if expr == "" {
		return m, fmt.Errorf("expression is required")
	}
	node, parseErr := parseFilterStrict(expr)
	if parseErr != nil {
		return m, parseErr
	}
	canonical := filterExprString(node)
	for _, sf := range m.savedFilters {
		sfID, _ := normalizeSavedFilterID(sf.ID)
		if sfID == id {
			if m.filterEditIsNew || !strings.EqualFold(strings.TrimSpace(m.filterEditOrigID), strings.TrimSpace(sf.ID)) {
				return m, fmt.Errorf("id %q already exists", id)
			}
		}
	}

	updated := make([]savedFilter, 0, len(m.savedFilters)+1)
	if m.filterEditIsNew {
		updated = append(updated, m.savedFilters...)
		updated = append(updated, savedFilter{ID: id, Name: name, Expr: canonical})
	} else {
		applied := false
		for _, sf := range m.savedFilters {
			if strings.EqualFold(strings.TrimSpace(sf.ID), strings.TrimSpace(m.filterEditOrigID)) {
				updated = append(updated, savedFilter{ID: id, Name: name, Expr: canonical})
				applied = true
				continue
			}
			updated = append(updated, sf)
		}
		if !applied {
			return m, fmt.Errorf("filter %q not found", strings.TrimSpace(m.filterEditOrigID))
		}
	}

	if err := saveSavedFilters(updated); err != nil {
		return m, err
	}
	m.savedFilters = updated
	m.commands = NewCommandRegistry(m.keys, m.savedFilters)
	if err := m.touchSavedFilterUsage(id, false); err != nil {
		return m, err
	}
	m.closeFilterEditor()
	m.setStatusf("Saved filter %q.", id)
	return m, nil
}

func (m model) deleteSavedFilterByID(id string) (model, error) {
	normalized, err := normalizeSavedFilterID(id)
	if err != nil {
		return m, err
	}
	updated := make([]savedFilter, 0, len(m.savedFilters))
	removed := false
	for _, sf := range m.savedFilters {
		if strings.EqualFold(strings.TrimSpace(sf.ID), normalized) {
			removed = true
			continue
		}
		updated = append(updated, sf)
	}
	if !removed {
		return m, fmt.Errorf("filter %q not found", normalized)
	}
	if err := saveSavedFilters(updated); err != nil {
		return m, err
	}
	m.savedFilters = updated
	m.commands = NewCommandRegistry(m.keys, m.savedFilters)
	if m.db != nil {
		if err := deleteFilterUsageState(m.db, normalized); err != nil {
			return m, err
		}
	}
	delete(m.filterUsage, normalized)
	if m.filterApplyPicker != nil {
		m.openFilterApplyPicker("")
	}
	if m.settItemCursor >= len(updated) && len(updated) > 0 {
		m.settItemCursor = len(updated) - 1
	}
	if len(updated) == 0 {
		m.settItemCursor = 0
	}
	return m, nil
}

func (m model) updateFilterEdit(msg tea.KeyMsg) (tea.Model, tea.Cmd) {
	if !m.filterEditOpen {
		return m, nil
	}
	scope := scopeFilterEdit
	keyName := normalizeKeyName(msg.String())
	switch {
	case m.isAction(scope, actionClose, msg):
		m.closeFilterEditor()
		m.setStatus("Filter edit cancelled.")
		return m, nil
	case keyName == "up" || keyName == "ctrl+p":
		m.filterEditFocus = (m.filterEditFocus - 1 + 3) % 3
		m.filterEditErr = ""
		return m, nil
	case keyName == "down" || keyName == "ctrl+n":
		m.filterEditFocus = (m.filterEditFocus + 1) % 3
		m.filterEditErr = ""
		return m, nil
	case m.isAction(scope, actionSave, msg):
		next, err := m.saveFilterEditor()
		if err != nil {
			next.filterEditErr = err.Error()
			return next, nil
		}
		return next, nil
	}

	var value *string
	var cursor *int
	switch m.filterEditFocus {
	case 0:
		value = &m.filterEditID
		cursor = &m.filterEditIDCur
	case 1:
		value = &m.filterEditName
		cursor = &m.filterEditNameCur
	default:
		value = &m.filterEditExpr
		cursor = &m.filterEditExprCur
	}

	switch keyName {
	case "left":
		moveInputCursorASCII(*value, cursor, -1)
		m.filterEditErr = ""
		return m, nil
	case "right":
		moveInputCursorASCII(*value, cursor, 1)
		m.filterEditErr = ""
		return m, nil
	}
	if isBackspaceKey(msg) {
		if deleteASCIIByteBeforeCursor(value, cursor) {
			m.filterEditErr = ""
		}
		return m, nil
	}
	if !isPrintableASCIIKey(msg.String()) {
		return m, nil
	}
	insert := msg.String()
	if m.filterEditFocus == 0 {
		insert = strings.ToLower(insert)
		if len(insert) != 1 {
			return m, nil
		}
		ch := insert[0]
		isAlphaNum := (ch >= 'a' && ch <= 'z') || (ch >= '0' && ch <= '9')
		if !(isAlphaNum || ch == '_' || ch == '-') {
			return m, nil
		}
	}
	if insertPrintableASCIIAtCursor(value, cursor, insert) {
		m.filterEditErr = ""
	}
	return m, nil
}
