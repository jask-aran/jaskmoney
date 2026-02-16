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

type PickerAction int

const (
	PickerActionNone PickerAction = iota
	PickerActionMoved
	PickerActionSelected
	PickerActionCancelled
)

type PickerResult struct {
	Action PickerAction
	Item   PickerItem
}

type Picker struct {
	title    string
	items    []PickerItem
	filtered []PickerItem
	query    string
	cursor   int
}

func NewPicker(title string, items []PickerItem) *Picker {
	p := &Picker{title: strings.TrimSpace(title)}
	p.SetItems(items)
	return p
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
	maxIdx := len(p.filtered) - 1
	if maxIdx < 0 {
		p.cursor = 0
		return
	}
	if p.cursor < maxIdx {
		p.cursor++
	}
}

func (p *Picker) CurrentItem() (PickerItem, bool) {
	if p == nil || len(p.filtered) == 0 {
		return PickerItem{}, false
	}
	idx := p.cursor
	if idx < 0 {
		idx = 0
	}
	if idx >= len(p.filtered) {
		idx = len(p.filtered) - 1
	}
	return p.filtered[idx], true
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
	case "enter":
		item, ok := p.CurrentItem()
		if !ok {
			return PickerResult{Action: PickerActionNone}
		}
		return PickerResult{Action: PickerActionSelected, Item: item}
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

	maxIdx := len(p.filtered) - 1
	if maxIdx < 0 {
		p.cursor = 0
	} else if p.cursor > maxIdx {
		p.cursor = maxIdx
	}
	if p.cursor < 0 {
		p.cursor = 0
	}
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
