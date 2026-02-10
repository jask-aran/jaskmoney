package main

import (
	"sort"
	"strings"

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
	multiSelect bool
	title       string
	createLabel string
}

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
		multiSelect: multiSelect,
		title:       title,
		createLabel: strings.TrimSpace(createLabel),
	}
	if p.createLabel == "" {
		p.createLabel = "Create"
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
				if isSelected {
					selectMark = "[x]"
				} else {
					selectMark = "[ ]"
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
			label := labelStyle.Render(it.Label)

			meta := ""
			if strings.TrimSpace(it.Meta) != "" {
				meta = lipgloss.NewStyle().Foreground(colorSubtext0).Render(" - " + strings.TrimSpace(it.Meta))
			}

			row := "  " + selectMark + label + meta
			row = stylePickerRow(row, isSelected, isCursor, width)
			lines = append(lines, row)
		}
	}

	if p.shouldShowCreate() {
		isCursor := p.cursor == selectableIdx
		label := lipgloss.NewStyle().Foreground(colorPeach).Render(p.createLabel + ` "` + strings.TrimSpace(p.query) + `"`)
		row := stylePickerRow("      "+label, false, isCursor, width)
		lines = append(lines, row)
	}

	selectDesc := "apply"
	if scope == scopeAccountNukePicker {
		selectDesc = "nuke"
	}
	footerParts := []string{
		renderActionHint(keys, scope, actionNavigate, "j/k", "navigate"),
	}
	if p.multiSelect {
		footerParts = append(footerParts, renderActionHint(keys, scope, actionToggleSelect, "space", "toggle"))
	}
	footerParts = append(footerParts,
		renderActionHint(keys, scope, actionSelect, "enter", selectDesc),
		renderActionHint(keys, scope, actionClose, "esc", "cancel"),
	)

	return renderModalContent(p.title, lines, strings.Join(footerParts, "  "))
}

func stylePickerRow(content string, selected, isCursor bool, width int) string {
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
