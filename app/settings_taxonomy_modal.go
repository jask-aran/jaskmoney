package app

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"jaskmoney-v2/core"
)

type taxonomyModalResultMsg struct {
	Status string
}

type taxonomyCategoryModal struct {
	mode    string
	title   string
	editKey string

	input      string
	inputCur   int
	fieldFocus int
	colorIdx   int

	status string
}

func newTaxonomyCategoryModal(mode string, category taxonomyCategory) core.Screen {
	s := &taxonomyCategoryModal{mode: mode, title: "Add Category"}
	if mode == taxonomyModeEdit {
		s.title = "Edit Category"
		s.editKey = category.Key
		s.input = category.Name
		s.inputCur = len(s.input)
		s.colorIdx = taxPaletteIndex(categoryAccentPalette, category.Color)
	}
	return s
}

func (s *taxonomyCategoryModal) Title() string { return s.title }

func (s *taxonomyCategoryModal) Scope() string { return "screen:settings:category-editor" }

func (s *taxonomyCategoryModal) Update(msg tea.Msg) (core.Screen, tea.Cmd, bool) {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok {
		return s, nil, false
	}
	key := taxNormalizeKey(keyMsg.String())
	switch key {
	case "esc":
		return s, nil, true
	case "tab":
		s.fieldFocus = (s.fieldFocus + 1) % 2
		return s, nil, false
	case "shift+tab":
		s.fieldFocus = (s.fieldFocus - 1 + 2) % 2
		return s, nil, false
	case "up":
		s.fieldFocus = (s.fieldFocus - 1 + 2) % 2
		return s, nil, false
	case "down":
		s.fieldFocus = (s.fieldFocus + 1) % 2
		return s, nil, false
	case "enter":
		cmd, pop := s.save()
		return s, cmd, pop
	}

	if s.fieldFocus == 0 {
		switch key {
		case "left":
			taxMoveInputCursorASCII(s.input, &s.inputCur, -1)
		case "right":
			taxMoveInputCursorASCII(s.input, &s.inputCur, 1)
		case "backspace":
			taxDeleteASCIIByteBeforeCursor(&s.input, &s.inputCur)
		default:
			taxInsertPrintableASCIIAtCursor(&s.input, &s.inputCur, keyMsg.String())
		}
		return s, nil, false
	}

	switch key {
	case "left", "h":
		s.colorIdx = (s.colorIdx - 1 + len(categoryAccentPalette)) % len(categoryAccentPalette)
	case "right", "l":
		s.colorIdx = (s.colorIdx + 1) % len(categoryAccentPalette)
	}
	return s, nil, false
}

func (s *taxonomyCategoryModal) save() (tea.Cmd, bool) {
	name := strings.TrimSpace(s.input)
	if name == "" {
		s.status = "Name cannot be empty."
		return nil, false
	}
	cfg, err := loadTaxonomyConfig(".")
	if err != nil {
		s.status = "Load failed: " + err.Error()
		return nil, false
	}

	color := categoryAccentPalette[s.colorIdx%len(categoryAccentPalette)]
	if s.mode == taxonomyModeAdd {
		key := uniqueKeyFromName(name, categoryKeySet(cfg.Categories), "category")
		cfg.Categories = append(cfg.Categories, taxonomyCategory{
			Key:       key,
			Name:      name,
			Color:     color,
			SortOrder: nextCategorySortOrder(cfg.Categories),
			IsDefault: false,
		})
	} else {
		updated := false
		for i := range cfg.Categories {
			if cfg.Categories[i].Key != s.editKey {
				continue
			}
			cfg.Categories[i].Name = name
			cfg.Categories[i].Color = color
			updated = true
			break
		}
		if !updated {
			s.status = "Category no longer exists."
			return nil, false
		}
	}

	sortCategories(cfg.Categories)
	if err := saveTaxonomyConfig(".", cfg); err != nil {
		s.status = "Save failed: " + err.Error()
		return nil, false
	}

	status := "Saved category: " + name
	return func() tea.Msg { return taxonomyModalResultMsg{Status: status} }, true
}

func (s *taxonomyCategoryModal) View(width, height int) string {
	lines := make([]string, 0, 8)
	lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true).Render(s.title))

	nameValue := s.input
	if s.fieldFocus == 0 {
		nameValue = taxRenderASCIIInputCursor(s.input, s.inputCur)
	}
	lines = append(lines, taxModalCursor(s.fieldFocus == 0)+taxLabelStyle("Name: ")+taxValueStyle(nameValue))

	colorLine := make([]string, 0, len(categoryAccentPalette))
	for i, hex := range categoryAccentPalette {
		swatch := lipgloss.NewStyle().Foreground(lipgloss.Color(hex)).Render("■")
		if i == s.colorIdx {
			swatch = lipgloss.NewStyle().Foreground(lipgloss.Color(hex)).Bold(true).Render("[■]")
		}
		colorLine = append(colorLine, swatch)
	}
	lines = append(lines, taxModalCursor(s.fieldFocus == 1)+taxLabelStyle("Color: ")+strings.Join(colorLine, " "))
	lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("tab field  left/right color  enter save  esc cancel"))

	if strings.TrimSpace(s.status) != "" {
		lines = append(lines, "", lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8")).Render(s.status))
	}
	view := strings.Join(lines, "\n")
	return core.ClipHeight(view, core.MaxInt(8, height))
}

type taxonomyTagModal struct {
	mode    string
	title   string
	editKey string

	input      string
	inputCur   int
	fieldFocus int
	colorIdx   int
	scopeKey   string

	categories []taxonomyCategory
	status     string
}

func newTaxonomyTagModal(mode string, tag taxonomyTag, categories []taxonomyCategory) core.Screen {
	s := &taxonomyTagModal{
		mode:       mode,
		title:      "Add Tag",
		categories: append([]taxonomyCategory(nil), categories...),
	}
	if mode == taxonomyModeEdit {
		s.title = "Edit Tag"
		s.editKey = tag.Key
		s.input = tag.Name
		s.inputCur = len(s.input)
		s.colorIdx = taxPaletteIndex(tagAccentPalette, tag.Color)
		s.scopeKey = tag.ScopeCategory
	}
	return s
}

func (s *taxonomyTagModal) Title() string { return s.title }

func (s *taxonomyTagModal) Scope() string { return "screen:settings:tag-editor" }

func (s *taxonomyTagModal) Update(msg tea.Msg) (core.Screen, tea.Cmd, bool) {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok {
		return s, nil, false
	}
	key := taxNormalizeKey(keyMsg.String())
	switch key {
	case "esc":
		return s, nil, true
	case "tab":
		s.fieldFocus = (s.fieldFocus + 1) % 3
		return s, nil, false
	case "shift+tab":
		s.fieldFocus = (s.fieldFocus - 1 + 3) % 3
		return s, nil, false
	case "up":
		s.fieldFocus = (s.fieldFocus - 1 + 3) % 3
		return s, nil, false
	case "down":
		s.fieldFocus = (s.fieldFocus + 1) % 3
		return s, nil, false
	case "enter":
		cmd, pop := s.save()
		return s, cmd, pop
	}

	if s.fieldFocus == 0 {
		switch key {
		case "left":
			taxMoveInputCursorASCII(s.input, &s.inputCur, -1)
		case "right":
			taxMoveInputCursorASCII(s.input, &s.inputCur, 1)
		case "backspace":
			taxDeleteASCIIByteBeforeCursor(&s.input, &s.inputCur)
		default:
			taxInsertPrintableASCIIAtCursor(&s.input, &s.inputCur, keyMsg.String())
		}
		return s, nil, false
	}

	if s.fieldFocus == 1 {
		switch key {
		case "left", "h":
			s.colorIdx = (s.colorIdx - 1 + len(tagAccentPalette)) % len(tagAccentPalette)
		case "right", "l":
			s.colorIdx = (s.colorIdx + 1) % len(tagAccentPalette)
		}
		return s, nil, false
	}

	opts := s.scopeOptions()
	idx := 0
	for i, v := range opts {
		if v == s.scopeKey {
			idx = i
			break
		}
	}
	switch key {
	case "left", "h":
		idx = (idx - 1 + len(opts)) % len(opts)
		s.scopeKey = opts[idx]
	case "right", "l":
		idx = (idx + 1) % len(opts)
		s.scopeKey = opts[idx]
	}
	return s, nil, false
}

func (s *taxonomyTagModal) save() (tea.Cmd, bool) {
	name := strings.TrimSpace(s.input)
	if name == "" {
		s.status = "Name cannot be empty."
		return nil, false
	}
	cfg, err := loadTaxonomyConfig(".")
	if err != nil {
		s.status = "Load failed: " + err.Error()
		return nil, false
	}

	scope := strings.TrimSpace(s.scopeKey)
	if scope != "" {
		if !categoryKeySet(cfg.Categories)[scope] {
			scope = ""
		}
	}

	color := tagAccentPalette[s.colorIdx%len(tagAccentPalette)]
	if s.mode == taxonomyModeAdd {
		key := uniqueKeyFromName(name, tagKeySet(cfg.Tags), "tag")
		cfg.Tags = append(cfg.Tags, taxonomyTag{
			Key:           key,
			Name:          name,
			Color:         color,
			SortOrder:     nextTagSortOrder(cfg.Tags),
			ScopeCategory: scope,
		})
	} else {
		updated := false
		for i := range cfg.Tags {
			if cfg.Tags[i].Key != s.editKey {
				continue
			}
			cfg.Tags[i].Name = name
			cfg.Tags[i].Color = color
			cfg.Tags[i].ScopeCategory = scope
			updated = true
			break
		}
		if !updated {
			s.status = "Tag no longer exists."
			return nil, false
		}
	}

	sortTags(cfg.Tags)
	if err := saveTaxonomyConfig(".", cfg); err != nil {
		s.status = "Save failed: " + err.Error()
		return nil, false
	}

	status := "Saved tag: " + name
	return func() tea.Msg { return taxonomyModalResultMsg{Status: status} }, true
}

func (s *taxonomyTagModal) View(width, height int) string {
	lines := make([]string, 0, 9)
	lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true).Render(s.title))

	nameValue := s.input
	if s.fieldFocus == 0 {
		nameValue = taxRenderASCIIInputCursor(s.input, s.inputCur)
	}
	lines = append(lines, taxModalCursor(s.fieldFocus == 0)+taxLabelStyle("Name: ")+taxValueStyle(nameValue))

	colorLine := make([]string, 0, len(tagAccentPalette))
	for i, hex := range tagAccentPalette {
		swatch := lipgloss.NewStyle().Foreground(lipgloss.Color(hex)).Render("■")
		if i == s.colorIdx {
			swatch = lipgloss.NewStyle().Foreground(lipgloss.Color(hex)).Bold(true).Render("[■]")
		}
		colorLine = append(colorLine, swatch)
	}
	lines = append(lines, taxModalCursor(s.fieldFocus == 1)+taxLabelStyle("Color: ")+strings.Join(colorLine, " "))

	scopeName := "Global"
	if strings.TrimSpace(s.scopeKey) != "" {
		scopeName = "Category: " + s.categoryNameForKey(s.scopeKey)
	}
	lines = append(lines, taxModalCursor(s.fieldFocus == 2)+taxLabelStyle("Scope: ")+taxValueStyle(scopeName))
	lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("tab field  left/right adjust  enter save  esc cancel"))

	if strings.TrimSpace(s.status) != "" {
		lines = append(lines, "", lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8")).Render(s.status))
	}
	view := strings.Join(lines, "\n")
	return core.ClipHeight(view, core.MaxInt(8, height))
}

func (s *taxonomyTagModal) scopeOptions() []string {
	out := make([]string, 0, len(s.categories)+1)
	out = append(out, "")
	for _, cat := range s.categories {
		out = append(out, cat.Key)
	}
	return out
}

func (s *taxonomyTagModal) categoryNameForKey(key string) string {
	if strings.TrimSpace(key) == "" {
		return "Global"
	}
	for _, cat := range s.categories {
		if cat.Key == key {
			return cat.Name
		}
	}
	return key
}
