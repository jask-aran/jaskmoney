package core

import (
	"sort"
	"strings"
)

type PickerItem struct {
	ID      string
	Label   string
	Section string
	Meta    string
	Search  string
}

type PickerCheckState int

const (
	PickerCheckStateNone PickerCheckState = iota
	PickerCheckStateSome
	PickerCheckStateAll
)

type PickerAction int

const (
	PickerActionNone PickerAction = iota
	PickerActionMoved
	PickerActionToggled
	PickerActionSelected
	PickerActionSubmitted
	PickerActionCreate
	PickerActionCancelled
)

type PickerResult struct {
	Action       PickerAction
	Item         PickerItem
	SelectedIDs  []string
	CreatedQuery string
}

type PickerRow struct {
	Item     PickerItem
	HasItem  bool
	IsCreate bool
}

type Picker struct {
	title    string
	items    []PickerItem
	filtered []PickerItem
	query    string
	cursor   int

	multiSelect bool
	createLabel string

	selected     map[string]bool
	baseSelected map[string]bool

	triState   bool
	checkState map[string]PickerCheckState
	baseState  map[string]PickerCheckState
	dirty      map[string]bool
}

func NewPicker(title string, items []PickerItem) *Picker {
	p := &Picker{title: strings.TrimSpace(title)}
	p.resetSelectionState()
	p.SetItems(items)
	return p
}

func (p *Picker) resetSelectionState() {
	p.selected = map[string]bool{}
	p.baseSelected = map[string]bool{}
	p.checkState = map[string]PickerCheckState{}
	p.baseState = map[string]PickerCheckState{}
	p.dirty = map[string]bool{}
}

func (p *Picker) Title() string {
	if p == nil {
		return ""
	}
	return p.title
}

func (p *Picker) Query() string {
	if p == nil {
		return ""
	}
	return p.query
}

func (p *Picker) Cursor() int {
	if p == nil {
		return 0
	}
	return p.cursor
}

func (p *Picker) Items() []PickerItem {
	if p == nil {
		return nil
	}
	return append([]PickerItem(nil), p.filtered...)
}

func (p *Picker) SetItems(items []PickerItem) {
	if p == nil {
		return
	}
	p.items = append([]PickerItem(nil), items...)
	p.rebuildFiltered()
}

func (p *Picker) SetQuery(q string) {
	if p == nil {
		return
	}
	p.query = q
	p.rebuildFiltered()
}

func (p *Picker) CursorUp() {
	if p == nil {
		return
	}
	if p.cursor > 0 {
		p.cursor--
	}
}

func (p *Picker) CursorDown() {
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

func (p *Picker) CurrentItem() (PickerItem, bool) {
	if p == nil {
		return PickerItem{}, false
	}
	row := p.CurrentRow()
	if !row.HasItem || row.IsCreate {
		return PickerItem{}, false
	}
	return row.Item, true
}

func (p *Picker) CurrentRow() PickerRow {
	if p == nil {
		return PickerRow{}
	}
	rows := p.selectableRows()
	if len(rows) == 0 {
		return PickerRow{}
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

func (p *Picker) SetMultiSelect(enabled bool) {
	if p == nil {
		return
	}
	p.multiSelect = enabled
}

func (p *Picker) MultiSelect() bool {
	if p == nil {
		return false
	}
	return p.multiSelect
}

func (p *Picker) SetCreateLabel(label string) {
	if p == nil {
		return
	}
	p.createLabel = strings.TrimSpace(label)
	p.rebuildFiltered()
}

func (p *Picker) ShouldShowCreate() bool {
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

func (p *Picker) SetSelectedIDs(ids []string) {
	if p == nil {
		return
	}
	p.triState = false
	p.selected = map[string]bool{}
	p.baseSelected = map[string]bool{}
	p.checkState = map[string]PickerCheckState{}
	p.baseState = map[string]PickerCheckState{}
	p.dirty = map[string]bool{}
	for _, id := range ids {
		key := strings.TrimSpace(id)
		if key == "" {
			continue
		}
		p.selected[key] = true
		p.baseSelected[key] = true
	}
}

func (p *Picker) SelectedIDs() []string {
	if p == nil || len(p.selected) == 0 {
		return nil
	}
	out := make([]string, 0, len(p.selected))
	for id := range p.selected {
		if p.selected[id] {
			out = append(out, id)
		}
	}
	sort.Strings(out)
	return out
}

func (p *Picker) SetTriState(states map[string]PickerCheckState) {
	if p == nil {
		return
	}
	p.triState = true
	p.checkState = make(map[string]PickerCheckState, len(states))
	p.baseState = make(map[string]PickerCheckState, len(states))
	p.dirty = map[string]bool{}
	p.selected = map[string]bool{}
	p.baseSelected = map[string]bool{}
	for id, state := range states {
		key := strings.TrimSpace(id)
		if key == "" {
			continue
		}
		p.checkState[key] = state
		p.baseState[key] = state
		if state == PickerCheckStateAll {
			p.selected[key] = true
			p.baseSelected[key] = true
		}
	}
}

func (p *Picker) StateForID(id string) PickerCheckState {
	if p == nil {
		return PickerCheckStateNone
	}
	key := strings.TrimSpace(id)
	if key == "" {
		return PickerCheckStateNone
	}
	if p.triState {
		if state, ok := p.checkState[key]; ok {
			return state
		}
		return PickerCheckStateNone
	}
	if p.selected[key] {
		return PickerCheckStateAll
	}
	return PickerCheckStateNone
}

func (p *Picker) Toggle() {
	if p == nil || !p.multiSelect {
		return
	}
	row := p.CurrentRow()
	if !row.HasItem || row.IsCreate {
		return
	}
	id := row.Item.ID
	if p.triState {
		curr := p.checkState[id]
		next := PickerCheckStateAll
		if curr == PickerCheckStateAll {
			next = PickerCheckStateNone
		}
		p.checkState[id] = next
		if next == PickerCheckStateAll {
			p.selected[id] = true
		} else {
			delete(p.selected, id)
		}
		base := p.baseState[id]
		if next == base {
			delete(p.dirty, id)
		} else {
			p.dirty[id] = true
		}
		return
	}
	if p.selected[id] {
		delete(p.selected, id)
	} else {
		p.selected[id] = true
	}
}

func (p *Picker) HasPendingChanges() bool {
	if p == nil {
		return false
	}
	if p.triState {
		return len(p.dirty) > 0
	}
	if len(p.selected) != len(p.baseSelected) {
		return true
	}
	for id := range p.selected {
		if !p.baseSelected[id] {
			return true
		}
	}
	return false
}

func (p *Picker) PendingPatch() (addIDs []string, removeIDs []string) {
	if p == nil {
		return nil, nil
	}
	if p.triState {
		for id := range p.dirty {
			switch p.checkState[id] {
			case PickerCheckStateAll:
				addIDs = append(addIDs, id)
			case PickerCheckStateNone:
				removeIDs = append(removeIDs, id)
			}
		}
		sort.Strings(addIDs)
		sort.Strings(removeIDs)
		return addIDs, removeIDs
	}

	for id := range p.selected {
		if !p.baseSelected[id] {
			addIDs = append(addIDs, id)
		}
	}
	for id := range p.baseSelected {
		if !p.selected[id] {
			removeIDs = append(removeIDs, id)
		}
	}
	sort.Strings(addIDs)
	sort.Strings(removeIDs)
	return addIDs, removeIDs
}

func (p *Picker) HandleKey(keyName string) PickerResult {
	if p == nil {
		return PickerResult{Action: PickerActionNone}
	}
	switch keyName {
	case "k", "up":
		before := p.cursor
		p.CursorUp()
		if p.cursor != before {
			return PickerResult{Action: PickerActionMoved}
		}
		return PickerResult{Action: PickerActionNone}
	case "j", "down":
		before := p.cursor
		p.CursorDown()
		if p.cursor != before {
			return PickerResult{Action: PickerActionMoved}
		}
		return PickerResult{Action: PickerActionNone}
	case "space", " ":
		if !p.multiSelect {
			return PickerResult{Action: PickerActionNone}
		}
		row := p.CurrentRow()
		if !row.HasItem || row.IsCreate {
			return PickerResult{Action: PickerActionNone}
		}
		p.Toggle()
		return PickerResult{
			Action:      PickerActionToggled,
			Item:        row.Item,
			SelectedIDs: p.SelectedIDs(),
		}
	case "enter":
		row := p.CurrentRow()
		if !row.HasItem && !row.IsCreate {
			return PickerResult{Action: PickerActionNone}
		}
		if row.IsCreate {
			return PickerResult{Action: PickerActionCreate, CreatedQuery: strings.TrimSpace(p.query)}
		}
		if p.multiSelect {
			return PickerResult{Action: PickerActionSubmitted, SelectedIDs: p.SelectedIDs()}
		}
		return PickerResult{Action: PickerActionSelected, Item: row.Item}
	case "esc":
		return PickerResult{Action: PickerActionCancelled}
	case "backspace":
		if len(p.query) > 0 {
			p.SetQuery(p.query[:len(p.query)-1])
		}
		return PickerResult{Action: PickerActionNone}
	default:
		if isPrintableASCIIKey(keyName) {
			p.SetQuery(p.query + keyName)
		}
		return PickerResult{Action: PickerActionNone}
	}
}

func (p *Picker) SectionOrder() []string {
	if p == nil {
		return nil
	}
	seen := make(map[string]bool, len(p.items))
	out := make([]string, 0, len(p.items))
	for _, item := range p.items {
		if seen[item.Section] {
			continue
		}
		seen[item.Section] = true
		out = append(out, item.Section)
	}
	return out
}

type scoredPickerItem struct {
	item  PickerItem
	score int
	index int
}

func (p *Picker) rebuildFiltered() {
	if p == nil {
		return
	}
	q := strings.TrimSpace(p.query)
	bySection := make(map[string][]scoredPickerItem)
	orderedSections := p.SectionOrder()
	for idx, item := range p.items {
		search := strings.TrimSpace(item.Search)
		if search == "" {
			search = item.Label
		}
		matched, score := fuzzyMatchScore(search, q)
		if !matched {
			continue
		}
		bySection[item.Section] = append(bySection[item.Section], scoredPickerItem{
			item:  item,
			score: score,
			index: idx,
		})
	}

	out := make([]PickerItem, 0, len(p.items))
	for _, section := range orderedSections {
		scored := bySection[section]
		if len(scored) == 0 {
			continue
		}
		sort.Slice(scored, func(i, j int) bool {
			if scored[i].score != scored[j].score {
				return scored[i].score > scored[j].score
			}
			return scored[i].index < scored[j].index
		})
		for _, row := range scored {
			out = append(out, row.item)
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

func (p *Picker) maxCursorIndex() int {
	if p == nil {
		return -1
	}
	count := len(p.filtered)
	if p.ShouldShowCreate() {
		count++
	}
	return count - 1
}

func (p *Picker) selectableRows() []PickerRow {
	if p == nil {
		return nil
	}
	rows := make([]PickerRow, 0, len(p.filtered)+1)
	for _, item := range p.filtered {
		rows = append(rows, PickerRow{Item: item, HasItem: true})
	}
	if p.ShouldShowCreate() {
		rows = append(rows, PickerRow{IsCreate: true})
	}
	return rows
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
