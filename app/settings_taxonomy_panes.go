package app

import (
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"

	"jaskmoney-v2/core"
	"jaskmoney-v2/core/widgets"
)

var categoryAccentPalette = []string{
	"#a6e3a1",
	"#94e2d5",
	"#fab387",
	"#89b4fa",
	"#cba6f7",
	"#f5c2e7",
	"#f2cdcd",
	"#74c7ec",
	"#b4befe",
	"#7f849c",
	"#f9e2af",
	"#f38ba8",
	"#eba0ac",
	"#f5e0dc",
	"#89dceb",
}

var tagAccentPalette = []string{
	"#f5e0dc",
	"#89dceb",
	"#b4befe",
	"#f2cdcd",
	"#74c7ec",
	"#f9e2af",
	"#eba0ac",
	"#cba6f7",
	"#f5c2e7",
	"#94e2d5",
	"#89b4fa",
	"#a6e3a1",
}

const (
	taxonomyModeNone = ""
	taxonomyModeAdd  = "add"
	taxonomyModeEdit = "edit"
)

type taxonomyColumn int

const (
	taxonomyColumnCategories taxonomyColumn = iota
	taxonomyColumnTags
)

type SettingsCategoriesTagsPane struct {
	id      string
	title   string
	scope   string
	jump    byte
	focus   bool
	focused bool

	cfg taxonomyConfig

	activeColumn   taxonomyColumn
	categoryCursor int
	tagCursor      int

	status string
	errMsg string
}

func NewSettingsCategoriesTagsPane(id, title, scope string, jumpKey byte, focusable bool) *SettingsCategoriesTagsPane {
	return &SettingsCategoriesTagsPane{
		id:           id,
		title:        title,
		scope:        scope,
		jump:         jumpKey,
		focus:        focusable,
		activeColumn: taxonomyColumnCategories,
	}
}

func (p *SettingsCategoriesTagsPane) ID() string      { return p.id }
func (p *SettingsCategoriesTagsPane) Title() string   { return p.title }
func (p *SettingsCategoriesTagsPane) Scope() string   { return p.scope }
func (p *SettingsCategoriesTagsPane) JumpKey() byte   { return p.jump }
func (p *SettingsCategoriesTagsPane) Focusable() bool { return p.focus }
func (p *SettingsCategoriesTagsPane) Init() tea.Cmd   { return nil }
func (p *SettingsCategoriesTagsPane) OnSelect() tea.Cmd {
	return nil
}
func (p *SettingsCategoriesTagsPane) OnDeselect() tea.Cmd {
	return nil
}
func (p *SettingsCategoriesTagsPane) OnFocus() tea.Cmd {
	p.focused = true
	p.reload()
	return nil
}
func (p *SettingsCategoriesTagsPane) OnBlur() tea.Cmd {
	p.focused = false
	return nil
}

func (p *SettingsCategoriesTagsPane) Update(msg tea.Msg) tea.Cmd {
	switch msg := msg.(type) {
	case taxonomyModalResultMsg:
		p.reload()
		if strings.TrimSpace(msg.Status) != "" {
			p.status = msg.Status
		}
		return nil
	}

	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok || !p.focused {
		return nil
	}
	if len(p.cfg.Categories) == 0 && len(p.cfg.Tags) == 0 && p.errMsg == "" {
		p.reload()
	}

	key := taxNormalizeKey(keyMsg.String())
	switch key {
	case "left", "h":
		p.activeColumn = taxonomyColumnCategories
	case "right", "l":
		p.activeColumn = taxonomyColumnTags
	case "j", "down":
		p.moveCursor(1)
	case "k", "up":
		p.moveCursor(-1)
	case "a":
		return p.openAddModal()
	case "e", "enter":
		return p.openEditModal()
	case "delete", "del":
		p.deleteSelected()
	}

	return nil
}

func (p *SettingsCategoriesTagsPane) View(width, height int, selected, focused bool) string {
	if len(p.cfg.Categories) == 0 && len(p.cfg.Tags) == 0 && p.errMsg == "" {
		p.reload()
	}

	contentWidth := taxMax(2, width-4)
	leftW, rightW := taxSplitColumns(contentWidth, 2)

	left := p.renderCategoriesColumn(leftW)
	right := p.renderTagsColumn(rightW)
	columns := lipgloss.JoinHorizontal(lipgloss.Top, left, "  ", right)

	lines := make([]string, 0, 6)
	if p.errMsg != "" {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#f38ba8")).Render("Config error: "+p.errMsg), "")
	}
	lines = append(lines, columns)
	lines = append(lines, "")
	lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("left/right switch list  j/k move  a add  e|enter edit  del delete"))
	if strings.TrimSpace(p.status) != "" {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#a6adc8")).Render(p.status))
	}

	content := strings.Join(lines, "\n")
	return widgets.Pane{Title: p.title, Height: height, Content: content, Selected: selected, Focused: focused}.Render(width, height)
}

func (p *SettingsCategoriesTagsPane) reload() {
	cfg, err := loadTaxonomyConfig(".")
	if err != nil {
		p.errMsg = err.Error()
		return
	}
	p.errMsg = ""
	p.cfg = cfg
	p.categoryCursor = taxClampCursor(p.categoryCursor, len(p.cfg.Categories))
	p.tagCursor = taxClampCursor(p.tagCursor, len(p.cfg.Tags))
}

func (p *SettingsCategoriesTagsPane) moveCursor(delta int) {
	if p.activeColumn == taxonomyColumnTags {
		p.tagCursor = taxMoveBoundedCursor(p.tagCursor, len(p.cfg.Tags), delta)
		return
	}
	p.categoryCursor = taxMoveBoundedCursor(p.categoryCursor, len(p.cfg.Categories), delta)
}

func (p *SettingsCategoriesTagsPane) openAddModal() tea.Cmd {
	if p.activeColumn == taxonomyColumnTags {
		return taxPushScreenCmd(newTaxonomyTagModal(taxonomyModeAdd, taxonomyTag{}, p.cfg.Categories))
	}
	return taxPushScreenCmd(newTaxonomyCategoryModal(taxonomyModeAdd, taxonomyCategory{}))
}

func (p *SettingsCategoriesTagsPane) openEditModal() tea.Cmd {
	if p.activeColumn == taxonomyColumnTags {
		if p.tagCursor < 0 || p.tagCursor >= len(p.cfg.Tags) {
			return nil
		}
		return taxPushScreenCmd(newTaxonomyTagModal(taxonomyModeEdit, p.cfg.Tags[p.tagCursor], p.cfg.Categories))
	}
	if p.categoryCursor < 0 || p.categoryCursor >= len(p.cfg.Categories) {
		return nil
	}
	return taxPushScreenCmd(newTaxonomyCategoryModal(taxonomyModeEdit, p.cfg.Categories[p.categoryCursor]))
}

func (p *SettingsCategoriesTagsPane) deleteSelected() {
	if p.activeColumn == taxonomyColumnTags {
		p.deleteSelectedTag()
		return
	}
	p.deleteSelectedCategory()
}

func (p *SettingsCategoriesTagsPane) deleteSelectedCategory() {
	if p.categoryCursor < 0 || p.categoryCursor >= len(p.cfg.Categories) {
		return
	}
	cat := p.cfg.Categories[p.categoryCursor]
	if cat.IsDefault {
		p.status = "Cannot delete the default category."
		return
	}
	removedKey := cat.Key
	p.cfg.Categories = append(p.cfg.Categories[:p.categoryCursor], p.cfg.Categories[p.categoryCursor+1:]...)
	for i := range p.cfg.Categories {
		p.cfg.Categories[i].SortOrder = i + 1
	}
	for i := range p.cfg.Tags {
		if p.cfg.Tags[i].ScopeCategory == removedKey {
			p.cfg.Tags[i].ScopeCategory = ""
		}
	}
	if err := saveTaxonomyConfig(".", p.cfg); err != nil {
		p.status = "Delete failed: " + err.Error()
		return
	}
	p.status = "Deleted category: " + cat.Name
	p.categoryCursor = taxClampCursor(p.categoryCursor, len(p.cfg.Categories))
	p.reload()
}

func (p *SettingsCategoriesTagsPane) deleteSelectedTag() {
	if p.tagCursor < 0 || p.tagCursor >= len(p.cfg.Tags) {
		return
	}
	tg := p.cfg.Tags[p.tagCursor]
	if strings.EqualFold(strings.TrimSpace(tg.Name), mandatoryIgnoreTagName) {
		p.status = "Cannot delete mandatory tag \"IGNORE\"."
		return
	}
	p.cfg.Tags = append(p.cfg.Tags[:p.tagCursor], p.cfg.Tags[p.tagCursor+1:]...)
	for i := range p.cfg.Tags {
		p.cfg.Tags[i].SortOrder = i + 1
	}
	if err := saveTaxonomyConfig(".", p.cfg); err != nil {
		p.status = "Delete failed: " + err.Error()
		return
	}
	p.status = "Deleted tag: " + tg.Name
	p.tagCursor = taxClampCursor(p.tagCursor, len(p.cfg.Tags))
	p.reload()
}

func (p *SettingsCategoriesTagsPane) renderCategoriesColumn(width int) string {
	lines := make([]string, 0, len(p.cfg.Categories)+2)
	headerStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#a6adc8")).Bold(true)
	if p.focused && p.activeColumn == taxonomyColumnCategories {
		headerStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true)
	}
	lines = append(lines, headerStyle.Render("Categories"))

	cursorSty := lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true)
	for i, cat := range p.cfg.Categories {
		prefix := "  "
		if p.focused && p.activeColumn == taxonomyColumnCategories && i == p.categoryCursor {
			prefix = cursorSty.Render("> ")
		}
		swatch := lipgloss.NewStyle().Foreground(lipgloss.Color(cat.Color)).Render("■")
		name := lipgloss.NewStyle().Foreground(lipgloss.Color("#cdd6f4")).Render(cat.Name)
		extra := ""
		if cat.IsDefault {
			extra = lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render(" (default)")
		}
		lines = append(lines, prefix+swatch+" "+name+extra)
	}
	if len(p.cfg.Categories) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("No categories."))
	}
	return lipgloss.NewStyle().Width(width).MaxWidth(width).Render(strings.Join(lines, "\n"))
}

func (p *SettingsCategoriesTagsPane) renderTagsColumn(width int) string {
	lines := make([]string, 0, len(p.cfg.Tags)+2)
	headerStyle := lipgloss.NewStyle().Foreground(lipgloss.Color("#a6adc8")).Bold(true)
	if p.focused && p.activeColumn == taxonomyColumnTags {
		headerStyle = lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true)
	}
	lines = append(lines, headerStyle.Render("Tags"))

	cursorSty := lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true)
	for i, tg := range p.cfg.Tags {
		prefix := "  "
		if p.focused && p.activeColumn == taxonomyColumnTags && i == p.tagCursor {
			prefix = cursorSty.Render("> ")
		}
		swatch := lipgloss.NewStyle().Foreground(lipgloss.Color(tg.Color)).Render("■")
		name := lipgloss.NewStyle().Foreground(lipgloss.Color("#cdd6f4")).Render(tg.Name)
		scopeLabel := " (global)"
		if strings.TrimSpace(tg.ScopeCategory) != "" {
			scopeLabel = " (" + p.categoryNameForKey(tg.ScopeCategory) + ")"
		}
		scopeText := lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render(scopeLabel)
		lines = append(lines, prefix+swatch+" "+name+scopeText)
	}
	if len(p.cfg.Tags) == 0 {
		lines = append(lines, lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render("No tags."))
	}
	return lipgloss.NewStyle().Width(width).MaxWidth(width).Render(strings.Join(lines, "\n"))
}

func (p *SettingsCategoriesTagsPane) categoryNameForKey(key string) string {
	if strings.TrimSpace(key) == "" {
		return "Global"
	}
	for _, cat := range p.cfg.Categories {
		if cat.Key == key {
			return cat.Name
		}
	}
	return key
}

func taxPushScreenCmd(screen core.Screen) tea.Cmd {
	if screen == nil {
		return nil
	}
	return func() tea.Msg { return core.PushScreenMsg{Screen: screen} }
}

func taxSplitColumns(total, gap int) (int, int) {
	if total <= 0 {
		return 1, 1
	}
	if gap < 0 {
		gap = 0
	}
	usable := total - gap
	if usable < 2 {
		return 1, 1
	}
	left := usable / 2
	right := usable - left
	if left < 1 {
		left = 1
	}
	if right < 1 {
		right = 1
	}
	return left, right
}

func taxNormalizeKey(key string) string {
	return strings.ToLower(strings.TrimSpace(key))
}

func taxMoveBoundedCursor(cursor, size, delta int) int {
	if size <= 0 {
		return 0
	}
	if cursor < 0 {
		cursor = 0
	}
	if cursor >= size {
		cursor = size - 1
	}
	if delta > 0 {
		if cursor < size-1 {
			cursor++
		}
		return cursor
	}
	if delta < 0 && cursor > 0 {
		cursor--
	}
	return cursor
}

func taxClampCursor(cursor, size int) int {
	if size <= 0 {
		return 0
	}
	if cursor < 0 {
		return 0
	}
	if cursor >= size {
		return size - 1
	}
	return cursor
}

func taxModalCursor(active bool) string {
	if active {
		return lipgloss.NewStyle().Foreground(lipgloss.Color("#89b4fa")).Bold(true).Render("> ")
	}
	return "  "
}

func taxLabelStyle(v string) string {
	return lipgloss.NewStyle().Foreground(lipgloss.Color("#a6adc8")).Render(v)
}

func taxValueStyle(v string) string {
	return lipgloss.NewStyle().Foreground(lipgloss.Color("#cdd6f4")).Render(v)
}

func taxPaletteIndex(palette []string, color string) int {
	color = strings.ToLower(strings.TrimSpace(color))
	for i, item := range palette {
		if strings.ToLower(strings.TrimSpace(item)) == color {
			return i
		}
	}
	return 0
}

func taxRenderASCIIInputCursor(s string, cursor int) string {
	idx := taxClampInputCursorASCII(s, cursor)
	return s[:idx] + "_" + s[idx:]
}

func taxClampInputCursorASCII(s string, cursor int) int {
	if cursor < 0 {
		return 0
	}
	if cursor > len(s) {
		return len(s)
	}
	return cursor
}

func taxMoveInputCursorASCII(s string, cursor *int, delta int) bool {
	if cursor == nil {
		return false
	}
	before := taxClampInputCursorASCII(s, *cursor)
	after := before + delta
	if after < 0 {
		after = 0
	}
	if after > len(s) {
		after = len(s)
	}
	*cursor = after
	return before != after
}

func taxInsertPrintableASCIIAtCursor(s *string, cursor *int, key string) bool {
	if s == nil || cursor == nil {
		return false
	}
	if len(key) != 1 || key[0] < 32 || key[0] >= 127 {
		return false
	}
	idx := taxClampInputCursorASCII(*s, *cursor)
	*s = (*s)[:idx] + key + (*s)[idx:]
	*cursor = idx + 1
	return true
}

func taxDeleteASCIIByteBeforeCursor(s *string, cursor *int) bool {
	if s == nil || cursor == nil {
		return false
	}
	idx := taxClampInputCursorASCII(*s, *cursor)
	if idx == 0 {
		return false
	}
	*s = (*s)[:idx-1] + (*s)[idx:]
	*cursor = idx - 1
	return true
}

func taxMax(a, b int) int {
	if a > b {
		return a
	}
	return b
}
