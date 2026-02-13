package main

import (
	"fmt"
	"sort"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
)

type pickerItem struct {
	ID      int
	Label   string
	Color   string
	Section string
	Meta    string
}

type pickerState struct {
	items       []pickerItem
	filtered    []pickerItem
	query       string
	cursor      int
	selected    map[int]bool
	checkState  map[int]pickerCheckState
	baseState   map[int]pickerCheckState
	dirty       map[int]bool
	multiSelect bool
	cursorOnly  bool
	triState    bool
	title       string
	createLabel string
}

type pickerCheckState int

const (
	pickerStateNone pickerCheckState = iota
	pickerStateSome
	pickerStateAll
)

type pickerAction int

const (
	pickerActionNone pickerAction = iota
	pickerActionMoved
	pickerActionToggled
	pickerActionSelected
	pickerActionSubmitted
	pickerActionCreate
	pickerActionCancelled
)

type pickerResult struct {
	Action       pickerAction
	ItemID       int
	ItemLabel    string
	CreatedQuery string
	SelectedIDs  []int
}

type pickerSelectableRow struct {
	item     *pickerItem
	isCreate bool
}

type scoredPickerItem struct {
	item  pickerItem
	score int
}

func newPicker(title string, items []pickerItem, multiSelect bool, createLabel string) *pickerState {
	p := &pickerState{
		selected:    make(map[int]bool),
		checkState:  make(map[int]pickerCheckState),
		baseState:   make(map[int]pickerCheckState),
		dirty:       make(map[int]bool),
		multiSelect: multiSelect,
		title:       title,
		createLabel: strings.TrimSpace(createLabel),
	}
	p.SetItems(items)
	return p
}

func (p *pickerState) SetItems(items []pickerItem) {
	if p == nil {
		return
	}
	p.items = append([]pickerItem(nil), items...)
	p.rebuildFiltered()
}

func (p *pickerState) SetQuery(q string) {
	if p == nil {
		return
	}
	p.query = q
	p.rebuildFiltered()
}

func (p *pickerState) CursorUp() {
	if p == nil {
		return
	}
	if p.cursor > 0 {
		p.cursor--
	}
}

func (p *pickerState) CursorDown() {
	if p == nil {
		return
	}
	maxIdx := p.maxCursorIndex()
	if maxIdx < 0 {
		p.cursor = 0
		return
	}
	if p.cursor < maxIdx {
		p.cursor++
	}
}

func (p *pickerState) Toggle() {
	if p == nil || !p.multiSelect {
		return
	}
	row := p.currentRow()
	if row.item == nil || row.isCreate {
		return
	}
	if p.triState {
		curr := p.checkState[row.item.ID]
		next := pickerStateAll
		if curr == pickerStateAll {
			next = pickerStateNone
		}
		p.checkState[row.item.ID] = next
		if next == pickerStateAll {
			p.selected[row.item.ID] = true
		} else {
			delete(p.selected, row.item.ID)
		}
		base := p.baseState[row.item.ID]
		if next == base {
			delete(p.dirty, row.item.ID)
		} else {
			p.dirty[row.item.ID] = true
		}
		return
	}
	if p.selected[row.item.ID] {
		delete(p.selected, row.item.ID)
	} else {
		p.selected[row.item.ID] = true
	}
}

func (p *pickerState) Selected() []int {
	if p == nil || len(p.selected) == 0 {
		return nil
	}
	out := make([]int, 0, len(p.selected))
	for id := range p.selected {
		if p.selected[id] {
			out = append(out, id)
		}
	}
	sort.Ints(out)
	return out
}

func (p *pickerState) SetTriState(states map[int]pickerCheckState) {
	if p == nil {
		return
	}
	p.triState = true
	p.checkState = make(map[int]pickerCheckState, len(states))
	p.baseState = make(map[int]pickerCheckState, len(states))
	p.dirty = make(map[int]bool)
	p.selected = make(map[int]bool)
	for id, state := range states {
		p.checkState[id] = state
		p.baseState[id] = state
		if state == pickerStateAll {
			p.selected[id] = true
		}
	}
}

func (p *pickerState) HasPendingChanges() bool {
	return p != nil && len(p.dirty) > 0
}

func (p *pickerState) PendingTagPatch() (addIDs []int, removeIDs []int) {
	if p == nil {
		return nil, nil
	}
	for id := range p.dirty {
		switch p.checkState[id] {
		case pickerStateAll:
			addIDs = append(addIDs, id)
		case pickerStateNone:
			removeIDs = append(removeIDs, id)
		}
	}
	sort.Ints(addIDs)
	sort.Ints(removeIDs)
	return addIDs, removeIDs
}

func (p *pickerState) HandleKey(keyName string) pickerResult {
	if p == nil {
		return pickerResult{Action: pickerActionNone}
	}

	switch keyName {
	case "k", "up":
		before := p.cursor
		p.CursorUp()
		if p.cursor != before {
			return pickerResult{Action: pickerActionMoved}
		}
		return pickerResult{Action: pickerActionNone}
	case "j", "down":
		before := p.cursor
		p.CursorDown()
		if p.cursor != before {
			return pickerResult{Action: pickerActionMoved}
		}
		return pickerResult{Action: pickerActionNone}
	case "space", " ":
		if !p.multiSelect {
			return pickerResult{Action: pickerActionNone}
		}
		row := p.currentRow()
		if row.item == nil || row.isCreate {
			return pickerResult{Action: pickerActionNone}
		}
		p.Toggle()
		return pickerResult{
			Action:      pickerActionToggled,
			ItemID:      row.item.ID,
			ItemLabel:   row.item.Label,
			SelectedIDs: p.Selected(),
		}
	case "enter":
		row := p.currentRow()
		if row.isCreate {
			return pickerResult{
				Action:       pickerActionCreate,
				CreatedQuery: strings.TrimSpace(p.query),
			}
		}
		if p.multiSelect {
			return pickerResult{
				Action:      pickerActionSubmitted,
				SelectedIDs: p.Selected(),
			}
		}
		if row.item != nil {
			return pickerResult{
				Action:    pickerActionSelected,
				ItemID:    row.item.ID,
				ItemLabel: row.item.Label,
			}
		}
		return pickerResult{Action: pickerActionNone}
	case "esc":
		return pickerResult{Action: pickerActionCancelled}
	case "backspace":
		if len(p.query) > 0 {
			p.SetQuery(p.query[:len(p.query)-1])
		}
		return pickerResult{Action: pickerActionNone}
	default:
		if isPrintableASCIIKey(keyName) {
			p.SetQuery(p.query + keyName)
		}
		return pickerResult{Action: pickerActionNone}
	}
}

func (p *pickerState) HandleMsg(msg tea.KeyMsg, matches func(Action, tea.KeyMsg) bool) pickerResult {
	if p == nil {
		return pickerResult{Action: pickerActionNone}
	}

	if matches(actionClose, msg) {
		return pickerResult{Action: pickerActionCancelled}
	}
	if matches(actionToggleSelect, msg) {
		if !p.multiSelect {
			return pickerResult{Action: pickerActionNone}
		}
		row := p.currentRow()
		if row.item == nil || row.isCreate {
			return pickerResult{Action: pickerActionNone}
		}
		p.Toggle()
		return pickerResult{
			Action:      pickerActionToggled,
			ItemID:      row.item.ID,
			ItemLabel:   row.item.Label,
			SelectedIDs: p.Selected(),
		}
	}
	if matches(actionSelect, msg) {
		row := p.currentRow()
		if row.isCreate {
			return pickerResult{
				Action:       pickerActionCreate,
				CreatedQuery: strings.TrimSpace(p.query),
			}
		}
		if p.multiSelect {
			return pickerResult{
				Action:      pickerActionSubmitted,
				SelectedIDs: p.Selected(),
			}
		}
		if row.item != nil {
			return pickerResult{
				Action:    pickerActionSelected,
				ItemID:    row.item.ID,
				ItemLabel: row.item.Label,
			}
		}
		return pickerResult{Action: pickerActionNone}
	}
	if isBackspaceKey(msg) {
		if len(p.query) > 0 {
			p.SetQuery(p.query[:len(p.query)-1])
		}
		return pickerResult{Action: pickerActionNone}
	}
	if isPrintableASCIIKey(msg.String()) {
		p.SetQuery(p.query + msg.String())
		return pickerResult{Action: pickerActionNone}
	}
	if matches(actionUp, msg) || matches(actionDown, msg) {
		before := p.cursor
		delta := 0
		if matches(actionUp, msg) {
			delta = -1
		} else if matches(actionDown, msg) {
			delta = 1
		}
		if delta < 0 {
			p.CursorUp()
		} else if delta > 0 {
			p.CursorDown()
		}
		if p.cursor != before {
			return pickerResult{Action: pickerActionMoved}
		}
		return pickerResult{Action: pickerActionNone}
	}
	return pickerResult{Action: pickerActionNone}
}

func renderPicker(p *pickerState, width int, keys *KeyRegistry, scope string) string {
	if p == nil {
		return ""
	}
	var lines []string
	query := strings.TrimSpace(p.query)
	searchValue := lipgloss.NewStyle().Foreground(colorOverlay1).Render("(type to filter)")
	if query != "" {
		searchValue = searchInputStyle.Render(query)
	}
	searchLine := infoLabelStyle.Render("Filter: ") + searchValue
	if width > 0 {
		searchLine = padStyledLine(searchLine, width)
	}
	lines = append(lines, searchLine)

	orderedSections := p.sectionOrder()
	bySection := make(map[string][]pickerItem)
	for i := range p.filtered {
		it := p.filtered[i]
		bySection[it.Section] = append(bySection[it.Section], it)
	}

	selectableIdx := 0
	for _, section := range orderedSections {
		items := bySection[section]
		if len(items) == 0 {
			continue
		}
		if section != "" {
			header := sectionTitleStyle.Render(section + ":")
			if width > 0 {
				header = padStyledLine(header, width)
			}
			lines = append(lines, header)
		}
		for i := range items {
			it := items[i]
			isCursor := p.cursor == selectableIdx
			isSelected := p.multiSelect && p.selected[it.ID]
			selectableIdx++

			selectMark := ""
			if p.multiSelect {
				if p.triState {
					switch p.checkState[it.ID] {
					case pickerStateAll:
						selectMark = "[x]"
					case pickerStateSome:
						selectMark = "[-]"
					default:
						selectMark = "[ ]"
					}
				} else {
					if isSelected {
						selectMark = "[x]"
					} else {
						selectMark = "[ ]"
					}
				}
			} else {
				// Keep label columns aligned between single- and multi-select pickers.
				selectMark = "   "
			}
			selectMark += " "

			labelStyle := lipgloss.NewStyle().Foreground(colorOverlay1)
			if strings.TrimSpace(it.Color) != "" && it.Color != "#7f849c" {
				labelStyle = lipgloss.NewStyle().Foreground(lipgloss.Color(it.Color))
			}
			if p.cursorOnly && isCursor {
				labelStyle = labelStyle.Bold(true)
			}
			label := labelStyle.Render(it.Label)

			meta := ""
			if strings.TrimSpace(it.Meta) != "" {
				metaStyle := lipgloss.NewStyle().Foreground(colorSubtext0)
				if p.cursorOnly && isCursor {
					metaStyle = metaStyle.Bold(true)
				}
				meta = metaStyle.Render(" - " + strings.TrimSpace(it.Meta))
			}

			prefix := "  "
			if p.cursorOnly {
				prefix = modalCursor(isCursor)
			}
			row := prefix + selectMark + label + meta
			row = stylePickerRow(row, isSelected, isCursor, width, p.cursorOnly)
			lines = append(lines, row)
		}
	}

	if p.shouldShowCreate() {
		isCursor := p.cursor == selectableIdx
		createStyle := lipgloss.NewStyle().Foreground(colorPeach)
		if p.cursorOnly && isCursor {
			createStyle = createStyle.Bold(true)
		}
		label := createStyle.Render(p.createLabel + ` "` + strings.TrimSpace(p.query) + `"`)
		prefix := "      "
		if p.cursorOnly {
			prefix = modalCursor(isCursor) + "    "
		}
		row := stylePickerRow(prefix+label, false, isCursor, width, p.cursorOnly)
		lines = append(lines, row)
	}

	selectDesc := "apply"
	if scope == scopeTagPicker && p.triState && !p.HasPendingChanges() {
		selectDesc = "toggle"
	}
	var footer string
	if scope == scopeCategoryPicker || scope == scopeTagPicker {
		footer = fmt.Sprintf(
			"%s move  %s toggle  %s %s  %s cancel",
			actionKeyLabel(keys, scope, actionDown, "j"),
			actionKeyLabel(keys, scope, actionToggleSelect, "space"),
			actionKeyLabel(keys, scope, actionSelect, "enter"),
			selectDesc,
			actionKeyLabel(keys, scope, actionClose, "esc"),
		)
		if !p.multiSelect {
			footer = fmt.Sprintf(
				"%s move  %s %s  %s cancel",
				actionKeyLabel(keys, scope, actionDown, "j"),
				actionKeyLabel(keys, scope, actionSelect, "enter"),
				selectDesc,
				actionKeyLabel(keys, scope, actionClose, "esc"),
			)
		}
		footer = scrollStyle.Render(footer)
	} else {
		footerParts := []string{
			renderActionHint(keys, scope, actionDown, "j", "move"),
		}
		if p.multiSelect {
			footerParts = append(footerParts, renderActionHint(keys, scope, actionToggleSelect, "space", "toggle"))
		}
		footerParts = append(footerParts,
			renderActionHint(keys, scope, actionSelect, "enter", selectDesc),
			renderActionHint(keys, scope, actionClose, "esc", "cancel"),
		)
		footer = strings.Join(footerParts, "  ")
	}

	return renderModalContent(p.title, lines, footer)
}

func stylePickerRow(content string, selected, isCursor bool, width int, cursorOnly bool) string {
	if cursorOnly {
		style := lipgloss.NewStyle()
		if isCursor {
			style = style.Bold(true)
		}
		row := style.Render(content)
		if width > 0 {
			row = style.Render(padStyledLine(content, width))
		}
		return row
	}
	bg, cursorStrong := rowStateBackgroundAndCursor(selected, false, isCursor)
	style := lipgloss.NewStyle()
	if bg != "" {
		style = style.Background(bg)
	}
	if cursorStrong {
		style = style.Bold(true)
	}
	row := style.Render(content)
	if width > 0 {
		row = style.Render(padStyledLine(content, width))
	}
	return row
}

func padStyledLine(s string, width int) string {
	if width <= 0 {
		return s
	}
	w := lipgloss.Width(s)
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}

func pickerWindowBounds(total, cursor, offset, limit int) (start, end int, hasAbove, hasBelow bool) {
	if total <= 0 {
		return 0, 0, false, false
	}
	if limit <= 0 || limit > total {
		limit = total
	}
	if cursor < 0 {
		cursor = 0
	}
	if cursor >= total {
		cursor = total - 1
	}
	if offset < 0 {
		offset = 0
	}
	maxOffset := max(0, total-limit)
	if offset > maxOffset {
		offset = maxOffset
	}
	if cursor < offset {
		offset = cursor
	}
	maxVisible := offset + limit - 1
	if cursor > maxVisible {
		offset = cursor - limit + 1
	}
	if offset > maxOffset {
		offset = maxOffset
	}
	if offset < 0 {
		offset = 0
	}
	end = offset + limit
	if end > total {
		end = total
	}
	return offset, end, offset > 0, end < total
}

func (p *pickerState) rebuildFiltered() {
	if p == nil {
		return
	}
	q := strings.TrimSpace(p.query)
	bySection := make(map[string][]scoredPickerItem)
	orderedSections := p.sectionOrder()
	for _, it := range p.items {
		matched, score := fuzzyMatchScore(it.Label, q)
		if !matched {
			continue
		}
		bySection[it.Section] = append(bySection[it.Section], scoredPickerItem{
			item:  it,
			score: score,
		})
	}

	out := make([]pickerItem, 0, len(p.items))
	for _, section := range orderedSections {
		scored := bySection[section]
		if len(scored) == 0 {
			continue
		}
		sort.Slice(scored, func(i, j int) bool {
			if scored[i].score != scored[j].score {
				return scored[i].score > scored[j].score
			}
			li := strings.ToLower(scored[i].item.Label)
			lj := strings.ToLower(scored[j].item.Label)
			if li != lj {
				return li < lj
			}
			return scored[i].item.ID < scored[j].item.ID
		})
		for i := range scored {
			out = append(out, scored[i].item)
		}
	}
	p.filtered = out

	maxIdx := p.maxCursorIndex()
	if maxIdx < 0 {
		p.cursor = 0
	} else if p.cursor > maxIdx {
		p.cursor = maxIdx
	}
	if p.cursor < 0 {
		p.cursor = 0
	}
}

func (p *pickerState) sectionOrder() []string {
	if p == nil {
		return nil
	}
	seen := make(map[string]bool)
	out := make([]string, 0, len(p.items))
	for i := range p.items {
		section := p.items[i].Section
		if seen[section] {
			continue
		}
		seen[section] = true
		out = append(out, section)
	}
	return out
}

func (p *pickerState) shouldShowCreate() bool {
	if p == nil {
		return false
	}
	if strings.TrimSpace(p.createLabel) == "" {
		return false
	}
	q := strings.TrimSpace(p.query)
	if q == "" {
		return false
	}
	for i := range p.items {
		if strings.EqualFold(strings.TrimSpace(p.items[i].Label), q) {
			return false
		}
	}
	return true
}

func (p *pickerState) maxCursorIndex() int {
	if p == nil {
		return -1
	}
	count := len(p.filtered)
	if p.shouldShowCreate() {
		count++
	}
	return count - 1
}

func (p *pickerState) selectableRows() []pickerSelectableRow {
	if p == nil {
		return nil
	}
	rows := make([]pickerSelectableRow, 0, len(p.filtered)+1)
	for i := range p.filtered {
		item := p.filtered[i]
		rows = append(rows, pickerSelectableRow{item: &item})
	}
	if p.shouldShowCreate() {
		rows = append(rows, pickerSelectableRow{isCreate: true})
	}
	return rows
}

func (p *pickerState) currentRow() pickerSelectableRow {
	rows := p.selectableRows()
	if len(rows) == 0 {
		return pickerSelectableRow{}
	}
	idx := p.cursor
	if idx < 0 {
		idx = 0
	}
	if idx >= len(rows) {
		idx = len(rows) - 1
	}
	return rows[idx]
}

func fuzzyMatchScore(label, query string) (bool, int) {
	if query == "" {
		return true, 0
	}
	labelLower := strings.ToLower(label)
	queryLower := strings.ToLower(query)

	matchIdx := make([]int, 0, len(queryLower))
	searchFrom := 0
	for i := 0; i < len(queryLower); i++ {
		ch := queryLower[i]
		found := false
		for j := searchFrom; j < len(labelLower); j++ {
			if labelLower[j] == ch {
				matchIdx = append(matchIdx, j)
				searchFrom = j + 1
				found = true
				break
			}
		}
		if !found {
			return false, 0
		}
	}

	score := len(queryLower)
	if len(matchIdx) > 0 && matchIdx[0] == 0 {
		score += 10
	}
	for i := 1; i < len(matchIdx); i++ {
		if matchIdx[i] == matchIdx[i-1]+1 {
			score += 3
		}
	}
	if strings.EqualFold(strings.TrimSpace(label), strings.TrimSpace(query)) {
		score += 20
	}
	return true, score
}

func isPrintableASCIIKey(keyName string) bool {
	return len(keyName) == 1 && keyName[0] >= 32 && keyName[0] < 127
}
