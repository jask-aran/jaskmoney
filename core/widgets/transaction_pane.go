package widgets

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/charmbracelet/x/ansi"
	_ "modernc.org/sqlite"

	"jaskmoney-v2/core/filtering"
)

const (
	sortByDate = iota
	sortByAmount
	sortByDescription
	sortByCategory
	sortColumnCount
)

type txnRow struct {
	id            int
	importIndex   int
	accountName   string
	dateISO       string
	amount        float64
	description   string
	categoryName  string
	categoryColor string
	notes         string
}

type txnTag struct {
	name  string
	color string
}

type OpenTransactionQuickCategoryMsg struct {
	TransactionIDs []int
}

type OpenTransactionQuickTagMsg struct {
	TransactionIDs []int
}

type OpenTransactionDetailMsg struct {
	TransactionID int
}

type OpenTransactionFilterMsg struct {
	Expr string
}

type ApplyTransactionFilterMsg struct {
	Expr string
}

type TransactionPaneStatusMsg struct {
	Text  string
	IsErr bool
	Code  string
}

type TransactionPane struct {
	id         string
	title      string
	scope      string
	jump       byte
	focus      bool
	cursor     int
	topIndex   int
	lastHeight int
	sortCol    int
	sortAsc    bool
	filterExpr *filtering.Node
	filterRaw  string
	filterErr  string
}

func NewTransactionPane(id, title, scope string, jumpKey byte, focusable bool) *TransactionPane {
	return &TransactionPane{
		id: id, title: title, scope: scope, jump: jumpKey, focus: focusable,
		sortCol: sortByDate,
	}
}

func (p *TransactionPane) ID() string      { return p.id }
func (p *TransactionPane) Title() string   { return p.title }
func (p *TransactionPane) Scope() string   { return p.scope }
func (p *TransactionPane) JumpKey() byte   { return p.jump }
func (p *TransactionPane) Focusable() bool { return p.focus }
func (p *TransactionPane) Init() tea.Cmd   { return nil }

func (p *TransactionPane) Update(msg tea.Msg) tea.Cmd {
	switch typed := msg.(type) {
	case ApplyTransactionFilterMsg:
		return p.applyFilterExpression(typed.Expr)
	}
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok {
		return nil
	}
	rows, _ := p.snapshotRows()
	visible := p.visibleRows()
	if visible <= 0 {
		visible = 1
	}
	p.clampCursorWindow(len(rows), visible)
	keyName := normalizeKeyName(keyMsg.String())
	switch keyName {
	case "enter":
		targetIDs := p.quickActionTargets(rows)
		if len(targetIDs) == 0 {
			return func() tea.Msg {
				return TransactionPaneStatusMsg{Text: "No transaction selected.", IsErr: true, Code: "TXN_NONE"}
			}
		}
		return func() tea.Msg {
			return OpenTransactionDetailMsg{TransactionID: targetIDs[0]}
		}
	case "/":
		return func() tea.Msg {
			return OpenTransactionFilterMsg{Expr: p.filterRaw}
		}
	case "f":
		p.filterExpr = nil
		p.filterRaw = ""
		p.filterErr = ""
		p.cursor = 0
		p.topIndex = 0
		return func() tea.Msg {
			return TransactionPaneStatusMsg{Text: "Filter cleared."}
		}
	case "s":
		p.sortCol = (p.sortCol + 1) % sortColumnCount
		return func() tea.Msg {
			return TransactionPaneStatusMsg{Text: "Sort: " + sortLabel(p.sortCol), Code: "TXN_SORT"}
		}
	case "shift+s":
		p.sortAsc = !p.sortAsc
		dir := "desc"
		if p.sortAsc {
			dir = "asc"
		}
		return func() tea.Msg {
			return TransactionPaneStatusMsg{Text: "Sort direction: " + dir, Code: "TXN_SORT"}
		}
	case "c":
		targetIDs := p.quickActionTargets(rows)
		if len(targetIDs) == 0 {
			return func() tea.Msg {
				return TransactionPaneStatusMsg{Text: "No transaction selected.", IsErr: true, Code: "TXN_NONE"}
			}
		}
		return func() tea.Msg {
			return OpenTransactionQuickCategoryMsg{TransactionIDs: append([]int(nil), targetIDs...)}
		}
	case "t":
		targetIDs := p.quickActionTargets(rows)
		if len(targetIDs) == 0 {
			return func() tea.Msg {
				return TransactionPaneStatusMsg{Text: "No transaction selected.", IsErr: true, Code: "TXN_NONE"}
			}
		}
		return func() tea.Msg {
			return OpenTransactionQuickTagMsg{TransactionIDs: append([]int(nil), targetIDs...)}
		}
	}
	delta := navDeltaFromKeyName(keyName)
	if delta == 0 {
		return nil
	}
	nextCursor := moveBoundedCursor(p.cursor, len(rows), delta)
	p.cursor = nextCursor
	if p.cursor < p.topIndex {
		p.topIndex = p.cursor
	}
	if p.cursor >= p.topIndex+visible {
		p.topIndex = p.cursor - visible + 1
	}
	p.clampCursorWindow(len(rows), visible)
	return nil
}

func (p *TransactionPane) quickActionTargets(rows []txnRow) []int {
	if len(rows) == 0 {
		return nil
	}
	if p.cursor < 0 || p.cursor >= len(rows) {
		return nil
	}
	return []int{rows[p.cursor].id}
}

func (p *TransactionPane) View(width, height int, selected, focused bool) string {
	p.lastHeight = height
	rows, tags := p.snapshotRows()
	contentWidth := width - 4
	if contentWidth < 1 {
		contentWidth = 1
	}
	visible := p.visibleRows()
	if visible <= 0 {
		visible = 1
	}
	p.clampCursorWindow(len(rows), visible)
	cursorTxnID := 0
	if p.cursor >= 0 && p.cursor < len(rows) {
		cursorTxnID = rows[p.cursor].id
	}
	overlayLines := make([]string, 0, 2)
	if strings.TrimSpace(p.filterRaw) != "" {
		filterLabel := "Filter: " + p.filterRaw
		if p.filterErr != "" {
			filterLabel = "Filter fallback: " + p.filterRaw + " (" + p.filterErr + ")"
		}
		overlayLines = append(overlayLines, ansi.Truncate(filterLabel, contentWidth, ""))
	}
	tableVisible := visible - len(overlayLines)
	if tableVisible < 1 {
		tableVisible = 1
	}
	table := renderTransactionTable(rows, tags, cursorTxnID, p.topIndex, tableVisible, contentWidth, p.sortCol, p.sortAsc)
	content := table
	if len(overlayLines) > 0 {
		content = strings.Join(append(overlayLines, table), "\n")
	}
	return Pane{
		Title:    p.title,
		Height:   height,
		Content:  content,
		Selected: selected,
		Focused:  focused,
	}.Render(width, height)
}

func (p *TransactionPane) OnSelect() tea.Cmd   { return nil }
func (p *TransactionPane) OnDeselect() tea.Cmd { return nil }
func (p *TransactionPane) OnFocus() tea.Cmd    { return nil }
func (p *TransactionPane) OnBlur() tea.Cmd     { return nil }

func (p *TransactionPane) visibleRows() int {
	contentHeight := p.lastHeight - 2
	if contentHeight < 1 {
		contentHeight = 1
	}
	// Header + rows + indicator should fit inside pane content area.
	rows := contentHeight - 2
	if rows < 1 {
		rows = 1
	}
	return rows
}

func (p *TransactionPane) clampCursorWindow(total, visible int) {
	if total <= 0 {
		p.cursor = 0
		p.topIndex = 0
		return
	}
	if p.cursor < 0 {
		p.cursor = 0
	}
	if p.cursor >= total {
		p.cursor = total - 1
	}
	if p.topIndex < 0 {
		p.topIndex = 0
	}
	maxTop := total - visible
	if maxTop < 0 {
		maxTop = 0
	}
	if p.topIndex > maxTop {
		p.topIndex = maxTop
	}
	if p.cursor < p.topIndex {
		p.topIndex = p.cursor
	}
	if p.cursor >= p.topIndex+visible {
		p.topIndex = p.cursor - visible + 1
	}
}

func (p *TransactionPane) snapshotRows() ([]txnRow, map[int][]txnTag) {
	rows, tags := loadTransactionRows("transactions.db")
	if len(rows) == 0 {
		return rows, tags
	}
	if p.filterExpr != nil {
		filtered := make([]txnRow, 0, len(rows))
		for _, row := range rows {
			if p.rowMatchesFilter(row, tags[row.id]) {
				filtered = append(filtered, row)
			}
		}
		rows = filtered
	}
	sortTransactionRows(rows, p.sortCol, p.sortAsc)
	return rows, tags
}

func (p *TransactionPane) rowMatchesFilter(row txnRow, tags []txnTag) bool {
	tagNames := make([]string, 0, len(tags))
	for _, tg := range tags {
		tagNames = append(tagNames, tg.name)
	}
	filterRow := filtering.Row{
		Description:  row.description,
		CategoryName: row.categoryName,
		Notes:        row.notes,
		AccountName:  row.accountName,
		DateISO:      row.dateISO,
		Amount:       row.amount,
		TagNames:     tagNames,
	}
	return filtering.Eval(p.filterExpr, filterRow)
}

func (p *TransactionPane) applyFilterExpression(expr string) tea.Cmd {
	raw := strings.TrimSpace(expr)
	if raw == "" {
		p.filterRaw = ""
		p.filterExpr = nil
		p.filterErr = ""
		p.cursor = 0
		p.topIndex = 0
		return func() tea.Msg {
			return TransactionPaneStatusMsg{Text: "Filter cleared.", Code: "TXN_FILTER"}
		}
	}
	node, err := filtering.Parse(raw)
	if err != nil {
		p.filterExpr = filtering.FallbackPlainText(raw)
		p.filterRaw = raw
		p.filterErr = err.Error()
		p.cursor = 0
		p.topIndex = 0
		return func() tea.Msg {
			return TransactionPaneStatusMsg{
				Text:  "Filter parse fallback applied: " + err.Error(),
				IsErr: true,
				Code:  "TXN_FILTER_PARSE",
			}
		}
	}
	if !filtering.ContainsFieldPredicate(node) {
		node = filtering.MarkTextMetadata(node)
	}
	p.filterExpr = node
	p.filterRaw = filtering.String(node)
	p.filterErr = ""
	p.cursor = 0
	p.topIndex = 0
	return func() tea.Msg {
		return TransactionPaneStatusMsg{
			Text: "Filter applied: " + p.filterRaw,
			Code: "TXN_FILTER",
		}
	}
}

func sortTransactionRows(rows []txnRow, sortCol int, sortAsc bool) {
	sort.SliceStable(rows, func(i, j int) bool {
		cmp := compareTxnRows(rows[i], rows[j], sortCol)
		if cmp == 0 {
			if sortAsc {
				return rows[i].id < rows[j].id
			}
			return rows[i].id > rows[j].id
		}
		if sortAsc {
			return cmp < 0
		}
		return cmp > 0
	})
}

func compareTxnRows(a, b txnRow, sortCol int) int {
	switch sortCol {
	case sortByAmount:
		return compareFloat(a.amount, b.amount)
	case sortByDescription:
		return strings.Compare(strings.ToLower(a.description), strings.ToLower(b.description))
	case sortByCategory:
		return strings.Compare(strings.ToLower(a.categoryName), strings.ToLower(b.categoryName))
	case sortByDate:
		fallthrough
	default:
		if c := strings.Compare(a.dateISO, b.dateISO); c != 0 {
			return c
		}
		return compareInt(a.importIndex, b.importIndex)
	}
}

func compareFloat(a, b float64) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	default:
		return 0
	}
}

func compareInt(a, b int) int {
	if a < b {
		return -1
	}
	if a > b {
		return 1
	}
	return 0
}

func sortLabel(col int) string {
	switch col {
	case sortByAmount:
		return "amount"
	case sortByDescription:
		return "description"
	case sortByCategory:
		return "category"
	default:
		return "date"
	}
}

func loadTransactionRows(path string) ([]txnRow, map[int][]txnTag) {
	db, err := sql.Open("sqlite", "file:"+path+"?cache=shared")
	if err != nil {
		return nil, map[int][]txnTag{}
	}
	defer db.Close()

	query := `
		SELECT
			t.id,
			COALESCE(a.name, ''),
			t.import_index,
			t.date_iso,
			t.amount,
			t.description,
			COALESCE(c.name, ''),
			COALESCE(c.color, ''),
			COALESCE(t.notes, '')
		FROM transactions t
		LEFT JOIN accounts a ON a.id = t.account_id
		LEFT JOIN categories c ON c.id = t.category_id
	`
	args := make([]any, 0, 8)
	scopeIDs := loadSelectedAccountIDs(db)
	if len(scopeIDs) > 0 {
		placeholders, scopeArgs := txnIntInClause(scopeIDs)
		query += ` WHERE t.account_id IN (` + placeholders + `)`
		args = append(args, scopeArgs...)
	}
	query += ` ORDER BY t.import_index ASC, t.id ASC`

	rows, err := db.Query(query, args...)
	if err != nil {
		return nil, map[int][]txnTag{}
	}
	defer rows.Close()

	out := make([]txnRow, 0, 128)
	for rows.Next() {
		var row txnRow
		if err := rows.Scan(
			&row.id,
			&row.accountName,
			&row.importIndex,
			&row.dateISO,
			&row.amount,
			&row.description,
			&row.categoryName,
			&row.categoryColor,
			&row.notes,
		); err != nil {
			continue
		}
		if strings.TrimSpace(row.categoryName) == "" {
			row.categoryName = "Uncategorised"
		}
		out = append(out, row)
	}
	txnIDs := make([]int, 0, len(out))
	for _, row := range out {
		txnIDs = append(txnIDs, row.id)
	}
	return out, loadTxnTags(db, txnIDs)
}

func loadTxnTags(db *sql.DB, txnIDs []int) map[int][]txnTag {
	out := map[int][]txnTag{}
	placeholders, args := txnIntInClause(txnIDs)
	if placeholders == "" {
		return out
	}
	rows, err := db.Query(`
		SELECT tt.transaction_id, tg.name
		FROM transaction_tags tt
		JOIN tags tg ON tg.id = tt.tag_id
		WHERE tt.transaction_id IN (`+placeholders+`)
		ORDER BY tt.transaction_id, tg.name
	`, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var txnID int
		var tagName string
		if err := rows.Scan(&txnID, &tagName); err != nil {
			continue
		}
		out[txnID] = append(out[txnID], txnTag{name: tagName, color: ""})
	}
	for id := range out {
		sort.SliceStable(out[id], func(i, j int) bool {
			return strings.ToLower(out[id][i].name) < strings.ToLower(out[id][j].name)
		})
	}
	return out
}

func loadSelectedAccountIDs(db *sql.DB) []int {
	if db == nil {
		return nil
	}
	rows, err := db.Query(`SELECT account_id FROM account_selection ORDER BY account_id`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	ids := make([]int, 0, 8)
	seen := map[int]bool{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err != nil {
			continue
		}
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		ids = append(ids, id)
	}
	return ids
}

func txnIntInClause(ids []int) (string, []any) {
	if len(ids) == 0 {
		return "", nil
	}
	parts := make([]string, 0, len(ids))
	args := make([]any, 0, len(ids))
	seen := map[int]bool{}
	for _, id := range ids {
		if id <= 0 || seen[id] {
			continue
		}
		seen[id] = true
		parts = append(parts, "?")
		args = append(args, id)
	}
	if len(parts) == 0 {
		return "", nil
	}
	return strings.Join(parts, ","), args
}

func renderTransactionTable(
	rows []txnRow,
	txnTags map[int][]txnTag,
	cursorTxnID int,
	topIndex, visible, width int,
	sortCol int,
	sortAsc bool,
) string {
	dateW := 9
	amountW := 11
	catW := 14
	accountW := 0
	tagsW := 0
	descTargetW := 40
	showTags := true
	showAccounts := hasMultipleAccountNames(rows)
	if showAccounts {
		accountW = 14
	}
	sep := " "
	numCols := 5 // date amount desc category tags
	if showAccounts {
		numCols++
	}
	numSeps := txnMax(0, numCols-1)
	fixedWithoutTags := dateW + amountW + catW + accountW + numSeps
	avail := width - fixedWithoutTags
	descW := txnMin(descTargetW, avail)
	if descW < 5 {
		descW = txnMax(5, avail)
	}
	if showTags {
		tagsW = width - fixedWithoutTags - descW
		if tagsW < 1 {
			tagsW = 1
		}
	}

	dateLbl := addSortIndicator("Date", sortByDate, sortCol, sortAsc)
	amtLbl := addSortIndicator("Amount", sortByAmount, sortCol, sortAsc)
	descLbl := addSortIndicator("Description", sortByDescription, sortCol, sortAsc)
	catLbl := addSortIndicator("Category", sortByCategory, sortCol, sortAsc)

	var header string
	if showAccounts {
		header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, accountW, "Account", descW, descLbl, catW, catLbl, tagsW, "Tags")
	} else {
		header = fmt.Sprintf("%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s"+sep+"%-*s", dateW, dateLbl, amountW, amtLbl, descW, descLbl, catW, catLbl, tagsW, "Tags")
	}
	lines := []string{lipgloss.NewStyle().Foreground(lipgloss.Color("#a6adc8")).Bold(true).Render(header)}

	end := topIndex + visible
	if end > len(rows) {
		end = len(rows)
	}
	for i := topIndex; i < end; i++ {
		row := rows[i]

		amountText := fmt.Sprintf("%.2f", row.amount)
		amountField := txnPadRight(amountText, amountW)
		isCursor := cursorTxnID != 0 && row.id == cursorTxnID
		rowBg, cursorStrong := rowStateBackgroundAndCursor(false, false, isCursor)
		cellStyle := lipgloss.NewStyle().Background(rowBg)
		if cursorStrong {
			cellStyle = cellStyle.Bold(true)
		}
		sepField := cellStyle.Render(sep)

		dateField := txnPadRight(formatDateShort(row.dateISO), dateW)
		descField := txnPadRight(truncate(row.description, descW), descW)

		amountStyle := lipgloss.NewStyle().Background(rowBg)
		if cursorStrong {
			amountStyle = amountStyle.Bold(true)
		}
		if row.amount > 0 {
			amountStyle = amountStyle.Foreground(lipgloss.Color("#a6e3a1"))
		} else if row.amount < 0 {
			amountStyle = amountStyle.Foreground(lipgloss.Color("#f38ba8"))
		}
		amountField = amountStyle.Render(amountField)

		catField := renderCategoryTagOnBackground(row.categoryName, row.categoryColor, catW, rowBg, cursorStrong)
		tagField := renderTagsOnBackground(txnTags[row.id], tagsW, rowBg, cursorStrong)

		var line string
		if showAccounts {
			accountField := cellStyle.Render(txnPadRight(truncate(row.accountName, accountW), accountW))
			line = cellStyle.Render(dateField) + sepField + amountField + sepField + accountField + sepField + cellStyle.Render(descField) + sepField + catField + sepField + tagField
		} else {
			line = cellStyle.Render(dateField) + sepField + amountField + sepField + cellStyle.Render(descField) + sepField + catField + sepField + tagField
		}
		line = ansi.Truncate(line, width, "")
		line = line + cellStyle.Render(strings.Repeat(" ", txnMax(0, width-ansi.StringWidth(line))))
		lines = append(lines, line)
	}

	total := len(rows)
	if total > 0 && visible > 0 {
		start := topIndex + 1
		endIdx := topIndex + visible
		if endIdx > total {
			endIdx = total
		}
		shown := endIdx - start + 1
		if shown < 0 {
			shown = 0
		}
		indicator := lipgloss.NewStyle().Foreground(lipgloss.Color("#7f849c")).Render(fmt.Sprintf("── showing %d-%d of %d (%d) ──", start, endIdx, total, shown))
		lines = append(lines, indicator)
	}

	return strings.Join(lines, "\n")
}

func hasMultipleAccountNames(rows []txnRow) bool {
	seen := make(map[string]bool)
	for _, r := range rows {
		name := strings.TrimSpace(r.accountName)
		if name == "" {
			continue
		}
		seen[strings.ToLower(name)] = true
		if len(seen) > 1 {
			return true
		}
	}
	return false
}

func addSortIndicator(label string, col, activeCol int, asc bool) string {
	if col != activeCol {
		return label
	}
	if asc {
		return label + " ▲"
	}
	return label + " ▼"
}

func renderCategoryTagOnBackground(name, color string, width int, bg lipgloss.Color, bold bool) string {
	display := truncate(name, txnMax(1, width-1))
	style := lipgloss.NewStyle().Background(bg)
	if bold {
		style = style.Bold(true)
	}
	if color == "" || color == "#7f849c" {
		style = style.Foreground(lipgloss.Color("#7f849c"))
	} else {
		style = style.Foreground(lipgloss.Color(color))
	}
	return style.Render(txnPadRight(display, width))
}

func renderTagsOnBackground(tags []txnTag, width int, bg lipgloss.Color, bold bool) string {
	base := lipgloss.NewStyle().Background(bg)
	if bold {
		base = base.Bold(true)
	}
	if len(tags) == 0 {
		return base.Foreground(lipgloss.Color("#7f849c")).Render(txnPadRight("-", width))
	}
	parts := make([]string, 0, len(tags))
	for _, tg := range tags {
		s := base
		if strings.TrimSpace(tg.color) != "" {
			s = s.Foreground(lipgloss.Color(tg.color))
		} else {
			s = s.Foreground(lipgloss.Color("#bac2de"))
		}
		parts = append(parts, s.Render(tg.name))
	}
	joined := strings.Join(parts, base.Foreground(lipgloss.Color("#7f849c")).Render(","))
	if ansi.StringWidth(joined) > width {
		joined = ansi.Truncate(joined, width, "")
	}
	rem := width - ansi.StringWidth(joined)
	if rem > 0 {
		joined += base.Render(strings.Repeat(" ", rem))
	}
	return joined
}

func rowStateBackgroundAndCursor(selected, highlighted, isCursor bool) (lipgloss.Color, bool) {
	switch {
	case isCursor && selected && highlighted:
		return lipgloss.Color("#89b4fa"), true
	case isCursor && selected:
		return lipgloss.Color("#89b4fa"), true
	case isCursor && highlighted:
		return lipgloss.Color("#74c7ec"), true
	case isCursor:
		return lipgloss.Color("#585b70"), true
	case selected && highlighted:
		return lipgloss.Color("#45475a"), false
	case selected:
		return lipgloss.Color("#313244"), false
	case highlighted:
		return lipgloss.Color("#181825"), false
	default:
		return "", false
	}
}

func formatDateShort(dateISO string) string {
	t, err := time.Parse("2006-01-02", dateISO)
	if err != nil {
		return dateISO
	}
	return t.Format("02-01-06")
}

func truncate(s string, width int) string {
	if width <= 0 {
		return ""
	}
	return ansi.Truncate(s, width, "")
}

func txnPadRight(s string, width int) string {
	if width <= 0 {
		return ""
	}
	s = ansi.Truncate(s, width, "")
	w := ansi.StringWidth(s)
	if w >= width {
		return s
	}
	return s + strings.Repeat(" ", width-w)
}

func navDeltaFromKeyName(keyName string) int {
	switch keyName {
	case "j", "down", "ctrl+n", "ctrl+j", "l", "right", "shift+down", "shift+j":
		return 1
	case "k", "up", "ctrl+p", "ctrl+k", "h", "left", "shift+up", "shift+k":
		return -1
	default:
		return 0
	}
}

func moveBoundedCursor(cursor, size, delta int) int {
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
	if delta < 0 {
		if cursor > 0 {
			cursor--
		}
	}
	return cursor
}

func normalizeKeyName(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

func txnMin(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func txnMax(a, b int) int {
	if a > b {
		return a
	}
	return b
}
