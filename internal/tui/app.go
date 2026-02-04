package tui

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/lipgloss"
	"github.com/google/uuid"

	"github.com/jask/jaskmoney/internal/config"
	"github.com/jask/jaskmoney/internal/database/repository"
	"github.com/jask/jaskmoney/internal/service"
)

// App ties together views.
type App struct {
	ctx               context.Context
	repos             Repos
	services          Services
	cfg               config.Config
	state             appState
	transactions      []repository.Transaction
	pending           []pendingView
	categories        []repository.Category
	categoryName      map[string]string // id -> name
	tags              []repository.Tag
	tagNameToID       map[string]string
	txCursor          int
	recCursor         int
	categoryCursor    int
	settingsCursor    int
	tagInput          string
	month             time.Time
	status            string
	tz                *time.Location
	modal             modalState
	settingsMode      settingsMode
	inputBuffer       string
	editingCategoryID string
	editingTxID       string
	apiKeyCached      string
	showAPIKey        bool
	currency          string
	dateFormat        string

	// import flow
	importPath  string
	lastImport  *service.IngestResult
	defaultAcct string
}

type Repos struct {
	Transactions *repository.TransactionRepo
	Categories   *repository.CategoryRepo
	Pending      *repository.ReconciliationRepo
	Tags         *repository.TagRepo
}

type Services struct {
	Categorizer *service.CategorizerService
	Reconciler  *service.Reconciler
	Ingest      *service.IngestService
	Maintenance *service.MaintenanceService
}

type appState string

const (
	viewDashboard    appState = "dashboard"
	viewTransactions appState = "transactions"
	viewReconcile    appState = "reconcile"
	viewImport       appState = "import"
	viewSettings     appState = "settings"
)

type modalState string

const (
	modalNone           modalState = ""
	modalCategoryPicker modalState = "categoryPicker"
	modalConfirmReset   modalState = "confirmReset"
	modalEditCategory   modalState = "editCategory"
	modalNewCategory    modalState = "newCategory"
	modalEditAPIKey     modalState = "editAPIKey"
	modalTagEditor      modalState = "tagEditor"
)

type settingsMode string

const (
	settingsModeIdle    settingsMode = "idle"
	settingsModeNew     settingsMode = "newCategory"
	settingsModeRename  settingsMode = "renameCategory"
	settingsModeAPIKey  settingsMode = "apiKey"
	settingsModeConfirm settingsMode = "confirm"
)

func New(ctx context.Context, cfg config.Config, repos Repos, services Services, tz *time.Location) *App {
	if tz == nil {
		tz = time.Local
	}
	apiKey := os.Getenv(cfg.LLM.APIKeyEnv)
	if apiKey == "" {
		apiKey = cfg.LLM.APIKey
	}
	return &App{
		ctx:          ctx,
		repos:        repos,
		services:     services,
		cfg:          cfg,
		month:        time.Now().UTC(),
		tz:           tz,
		importPath:   "ANZ 040226.csv",
		defaultAcct:  "ANZ",
		apiKeyCached: apiKey,
		currency:     cfg.UI.CurrencySymbol,
		dateFormat:   cfg.UI.DateFormat,
	}
}

func (a *App) Init() tea.Cmd {
	return tea.Batch(a.loadTransactions(), a.loadPending(), a.loadCategories(), a.loadTags())
}

func (a *App) loadTransactions() tea.Cmd {
	return func() tea.Msg {
		list, err := a.repos.Transactions.List(a.ctx, repository.TransactionFilters{Month: a.month})
		if err != nil {
			return errMsg{err}
		}
		return transactionsMsg(list)
	}
}

func (a *App) loadPending() tea.Cmd {
	return func() tea.Msg {
		prs, err := a.repos.Pending.ListPending(a.ctx)
		if err != nil {
			return errMsg{err}
		}
		views := make([]pendingView, 0, len(prs))
		for _, pr := range prs {
			aTx, _ := a.repos.Transactions.Get(a.ctx, pr.TransactionAID)
			bTx, _ := a.repos.Transactions.Get(a.ctx, pr.TransactionBID)
			views = append(views, pendingView{PR: pr, A: aTx, B: bTx})
		}
		return pendingMsg(views)
	}
}

func (a *App) loadCategories() tea.Cmd {
	return func() tea.Msg {
		cats, err := a.repos.Categories.List(a.ctx)
		if err != nil {
			return errMsg{err}
		}
		return categoryListMsg(cats)
	}
}

func (a *App) loadTags() tea.Cmd {
	return func() tea.Msg {
		if a.repos.Tags == nil {
			return tagListMsg(nil)
		}
		tags, err := a.repos.Tags.List(a.ctx)
		if err != nil {
			return errMsg{err}
		}
		return tagListMsg(tags)
	}
}

func (a *App) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch m := msg.(type) {
	case tea.KeyMsg:
		if a.modal != modalNone {
			return a.handleModalKey(m)
		}
		if a.state == viewImport {
			return a.handleImportKey(m)
		}
		if a.state == viewSettings {
			return a.handleSettingsKey(m)
		}
		switch m.String() {
		case "q", "ctrl+c":
			return a, tea.Quit
		case "t":
			if a.state == viewTransactions {
				a.openTagEditor()
			} else {
				a.state = viewTransactions
			}
		case "d":
			a.state = viewDashboard
		case "r":
			a.state = viewReconcile
		case "i":
			a.state = viewImport
			a.status = ""
		case "p":
			a.state = viewSettings
			a.status = ""
		case "up", "k":
			if a.state == viewTransactions && a.txCursor > 0 {
				a.txCursor--
			}
			if a.state == viewReconcile && a.recCursor > 0 {
				a.recCursor--
			}
			if a.state == viewSettings && a.settingsCursor > 0 {
				a.settingsCursor--
			}
		case "down", "j":
			if a.state == viewTransactions && a.txCursor < len(a.transactions)-1 {
				a.txCursor++
			}
			if a.state == viewReconcile && a.recCursor < len(a.pending)-1 {
				a.recCursor++
			}
			if a.state == viewSettings && a.settingsCursor < len(a.categories)-1 {
				a.settingsCursor++
			}
		case "a":
			if a.state == viewTransactions && len(a.transactions) > 0 {
				tx := a.transactions[a.txCursor]
				a.status = "categorizing..."
				return a, a.categorizeCmd(tx)
			}
		case "g":
			if a.state == viewTransactions {
				a.status = "categorizing..."
				return a, a.categorizeAllCmd()
			}
		case "s":
			if a.state == viewReconcile {
				a.status = "scanning..."
				return a, a.detectCmd()
			}
		case "y":
			if a.state == viewReconcile && len(a.pending) > 0 {
				id := a.pending[a.recCursor].PR.ID
				return a, a.reconcileDecisionCmd(id, true)
			}
		case "n":
			if a.state == viewReconcile && len(a.pending) > 0 {
				id := a.pending[a.recCursor].PR.ID
				return a, a.reconcileDecisionCmd(id, false)
			}
		case "c":
			if a.state == viewTransactions {
				a.modal = modalCategoryPicker
				if a.categoryCursor >= len(a.categories)+1 {
					a.categoryCursor = 0
				}
			}
		}
	case transactionsMsg:
		a.transactions = []repository.Transaction(m)
		if a.txCursor >= len(a.transactions) {
			a.txCursor = 0
		}
	case pendingMsg:
		a.pending = []pendingView(m)
		if a.recCursor >= len(a.pending) {
			a.recCursor = 0
		}
	case tagListMsg:
		a.tags = []repository.Tag(m)
		a.tagNameToID = make(map[string]string, len(a.tags))
		for _, t := range a.tags {
			a.tagNameToID[strings.ToLower(t.Name)] = t.ID
		}
	case categoryListMsg:
		a.categories = []repository.Category(m)
		a.categoryName = make(map[string]string, len(a.categories))
		for _, c := range a.categories {
			a.categoryName[c.ID] = c.Name
		}
	case statusMsg:
		a.status = string(m)
	case errMsg:
		a.status = "error: " + m.Error()
	case ingestDoneMsg:
		a.lastImport = &m.Result
		summary := fmt.Sprintf("imported %d, skipped %d", m.Result.Imported, m.Result.Skipped)
		if len(m.Result.Errors) > 0 {
			summary += fmt.Sprintf(", errors %d (see import view)", len(m.Result.Errors))
		}
		a.status = summary
		a.state = viewTransactions
		return a, tea.Batch(a.loadTransactions(), a.loadPending())
	}
	return a, nil
}

func (a *App) View() string {
	var body string
	switch a.state {
	case viewTransactions:
		body = a.renderTransactions()
	case viewReconcile:
		body = a.renderReconcile()
	case viewImport:
		body = a.renderImport()
	case viewSettings:
		body = a.renderSettings()
	default:
		body = a.renderDashboard()
	}
	if a.modal != modalNone {
		body += "\n\n" + a.renderModal()
	}
	return body
}

// commands
func (a *App) categorizeCmd(tx repository.Transaction) tea.Cmd {
	return tea.Batch(
		func() tea.Msg {
			_ = a.services.Categorizer.CategorizeTransaction(a.ctx, tx)
			return statusMsg("categorized")
		},
		a.loadTransactions(),
	)
}

func (a *App) categorizeAllCmd() tea.Cmd {
	return tea.Batch(
		func() tea.Msg {
			for _, tx := range a.transactions {
				_ = a.services.Categorizer.CategorizeTransaction(a.ctx, tx)
			}
			return statusMsg("categorization done")
		},
		a.loadTransactions(),
	)
}

func (a *App) detectCmd() tea.Cmd {
	return tea.Batch(
		func() tea.Msg {
			_ = a.services.Reconciler.DetectAndQueue(a.ctx)
			return statusMsg("scan complete")
		},
		a.loadPending(),
	)
}

func (a *App) reconcileDecisionCmd(id string, isDup bool) tea.Cmd {
	return tea.Batch(
		func() tea.Msg {
			_ = a.services.Reconciler.Decide(a.ctx, id, isDup)
			if isDup {
				return statusMsg("merged")
			}
			return statusMsg("dismissed")
		},
		a.loadPending(),
	)
}

func (a *App) setCategoryCmd(txID string, categoryID *string) tea.Cmd {
	return tea.Batch(
		func() tea.Msg {
			if err := a.repos.Transactions.UpdateCategory(a.ctx, txID, categoryID); err != nil {
				return errMsg{err}
			}
			if categoryID == nil {
				return statusMsg("category cleared")
			}
			return statusMsg("category updated")
		},
		a.loadTransactions(),
	)
}

func (a *App) createCategoryCmd(name string) tea.Cmd {
	return tea.Batch(
		func() tea.Msg {
			c := repository.Category{ID: uuid.NewString(), Name: strings.TrimSpace(name), SortOrder: len(a.categories) + 1}
			if err := a.repos.Categories.Upsert(a.ctx, c); err != nil {
				return errMsg{err}
			}
			return statusMsg("category added")
		},
		a.loadCategories(),
	)
}

func (a *App) renameCategoryCmd(cat repository.Category, name string) tea.Cmd {
	return tea.Batch(
		func() tea.Msg {
			c := cat
			c.Name = strings.TrimSpace(name)
			if err := a.repos.Categories.Upsert(a.ctx, c); err != nil {
				return errMsg{err}
			}
			return statusMsg("category renamed")
		},
		a.loadCategories(),
		a.loadTransactions(),
	)
}

func (a *App) deleteCategoryCmd(cat repository.Category) tea.Cmd {
	return tea.Batch(
		func() tea.Msg {
			if err := a.repos.Categories.Delete(a.ctx, cat.ID); err != nil {
				return errMsg{err}
			}
			return statusMsg("category removed")
		},
		a.loadCategories(),
		a.loadTransactions(),
	)
}

func (a *App) resetCmd() tea.Cmd {
	return tea.Batch(
		func() tea.Msg {
			if a.services.Maintenance == nil {
				return errMsg{fmt.Errorf("maintenance not configured")}
			}
			if err := a.services.Maintenance.Reset(a.ctx); err != nil {
				return errMsg{err}
			}
			a.txCursor, a.recCursor, a.settingsCursor = 0, 0, 0
			a.categoryCursor = 0
			return statusMsg("database reset (empty) - import or seed categories")
		},
		a.loadTransactions(),
		a.loadPending(),
		a.loadCategories(),
	)
}

func (a *App) saveAPIKeyCmd(key string) tea.Cmd {
	return tea.Batch(
		func() tea.Msg {
			a.cfg.LLM.APIKey = strings.TrimSpace(key)
			if err := config.Save(a.cfg); err != nil {
				return errMsg{err}
			}
			a.apiKeyCached = a.cfg.LLM.APIKey
			return statusMsg("API key saved to config (restart to apply)")
		},
	)
}

func (a *App) saveTagsCmd(tx repository.Transaction, input string) tea.Cmd {
	return tea.Batch(
		func() tea.Msg {
			names := normalizeTags(input)
			desired := map[string]string{} // name -> tagID
			for _, name := range names {
				lower := strings.ToLower(name)
				if id, ok := a.tagNameToID[lower]; ok {
					desired[lower] = id
					continue
				}
				if a.repos.Tags == nil {
					return errMsg{fmt.Errorf("tags repo not configured")}
				}
				tag, err := a.repos.Tags.ByName(a.ctx, name)
				if err != nil {
					return errMsg{err}
				}
				tagID := ""
				if tag == nil {
					tagID = uuid.NewString()
					if err := a.repos.Tags.Upsert(a.ctx, repository.Tag{ID: tagID, Name: name}); err != nil {
						return errMsg{err}
					}
				} else {
					tagID = tag.ID
				}
				desired[lower] = tagID
				a.tagNameToID[lower] = tagID
			}

			existing := map[string]repository.Tag{}
			for _, t := range tx.Tags {
				existing[strings.ToLower(t.Name)] = t
			}

			for _, id := range desired {
				if err := a.repos.Transactions.AttachTag(a.ctx, tx.ID, id); err != nil {
					return errMsg{err}
				}
			}
			for name, t := range existing {
				if _, ok := desired[name]; !ok {
					if err := a.repos.Transactions.RemoveTag(a.ctx, tx.ID, t.ID); err != nil {
						return errMsg{err}
					}
				}
			}
			return statusMsg("tags updated")
		},
		a.loadTransactions(),
		a.loadTags(),
	)
}

func (a *App) ingestCmd(path string) tea.Cmd {
	abs := path
	if !filepath.IsAbs(path) {
		if p, err := filepath.Abs(path); err == nil {
			abs = p
		}
	}
	a.status = "importing..."
	account := a.defaultAcct
	if a.services.Ingest == nil {
		return func() tea.Msg { return errMsg{fmt.Errorf("ingest service not configured")} }
	}
	return func() tea.Msg {
		f, err := os.Open(abs)
		if err != nil {
			return errMsg{fmt.Errorf("open %s: %w", abs, err)}
		}
		defer f.Close()

		res, err := a.services.Ingest.ImportANZSimple(a.ctx, f, account, a.tz)
		if err != nil {
			return errMsg{err}
		}
		if len(res.Errors) > 0 {
			for i := range res.Errors {
				res.Errors[i] = fmt.Errorf("%s: %w", filepath.Base(abs), res.Errors[i])
			}
		}
		return ingestDoneMsg{Result: res}
	}
}

func (a *App) handleImportKey(m tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch m.String() {
	case "q", "ctrl+c":
		return a, tea.Quit
	}
	switch m.Type {
	case tea.KeyEsc:
		a.state = viewDashboard
		a.status = ""
	case tea.KeyEnter:
		path := strings.TrimSpace(a.importPath)
		if path == "" {
			a.status = "enter a CSV path"
			return a, nil
		}
		return a, a.ingestCmd(path)
	case tea.KeyBackspace, tea.KeyCtrlH, tea.KeyDelete:
		if len(a.importPath) > 0 {
			a.importPath = a.importPath[:len(a.importPath)-1]
		}
	case tea.KeySpace:
		a.importPath += " "
	case tea.KeyRunes:
		a.importPath += string(m.Runes)
	}
	return a, nil
}

func (a *App) handleModalKey(m tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch a.modal {
	case modalCategoryPicker:
		switch m.String() {
		case "esc":
			a.modal = modalNone
		case "up", "k":
			if a.categoryCursor > 0 {
				a.categoryCursor--
			}
		case "down", "j":
			max := len(a.categories) // +1 for [none]
			if a.categoryCursor < max {
				a.categoryCursor++
			}
		case "enter":
			if len(a.transactions) == 0 {
				a.modal = modalNone
				return a, nil
			}
			tx := a.transactions[a.txCursor]
			a.modal = modalNone
			if a.categoryCursor == 0 {
				return a, a.setCategoryCmd(tx.ID, nil)
			}
			idx := a.categoryCursor - 1
			if idx >= len(a.categories) {
				return a, nil
			}
			catID := a.categories[idx].ID
			return a, a.setCategoryCmd(tx.ID, &catID)
		}
	case modalConfirmReset:
		switch m.String() {
		case "y", "Y":
			a.modal = modalNone
			return a, a.resetCmd()
		case "n", "N", "esc":
			a.modal = modalNone
		}
	case modalNewCategory, modalEditCategory, modalEditAPIKey:
		switch m.Type {
		case tea.KeyEsc:
			a.modal = modalNone
			a.inputBuffer = ""
			a.settingsMode = settingsModeIdle
		case tea.KeyEnter:
			text := strings.TrimSpace(a.inputBuffer)
			if text == "" {
				a.status = "enter a value"
				return a, nil
			}
			mode := a.modal
			a.modal = modalNone
			a.inputBuffer = ""
			switch mode {
			case modalNewCategory:
				a.settingsMode = settingsModeIdle
				return a, a.createCategoryCmd(text)
			case modalEditCategory:
				cat := a.categoryByID(a.editingCategoryID)
				if cat == nil {
					return a, nil
				}
				a.settingsMode = settingsModeIdle
				return a, a.renameCategoryCmd(*cat, text)
			case modalEditAPIKey:
				a.settingsMode = settingsModeIdle
				return a, a.saveAPIKeyCmd(text)
			}
		case tea.KeyBackspace, tea.KeyCtrlH, tea.KeyDelete:
			if len(a.inputBuffer) > 0 {
				a.inputBuffer = a.inputBuffer[:len(a.inputBuffer)-1]
			}
		case tea.KeySpace:
			a.inputBuffer += " "
		case tea.KeyRunes:
			a.inputBuffer += string(m.Runes)
		}
	case modalTagEditor:
		switch m.Type {
		case tea.KeyEsc:
			a.modal = modalNone
			a.tagInput = ""
		case tea.KeyEnter:
			text := strings.TrimSpace(a.tagInput)
			a.modal = modalNone
			if a.editingTxID == "" {
				return a, nil
			}
			tx := a.transactionByID(a.editingTxID)
			if tx == nil {
				return a, nil
			}
			return a, a.saveTagsCmd(*tx, text)
		case tea.KeyBackspace, tea.KeyCtrlH, tea.KeyDelete:
			if len(a.tagInput) > 0 {
				a.tagInput = a.tagInput[:len(a.tagInput)-1]
			}
		case tea.KeySpace:
			a.tagInput += " "
		case tea.KeyRunes:
			a.tagInput += string(m.Runes)
		}
	}
	return a, nil
}

func (a *App) handleSettingsKey(m tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch m.String() {
	case "q", "ctrl+c":
		return a, tea.Quit
	case "esc", "d":
		a.state = viewDashboard
		a.status = ""
		return a, nil
	case "t":
		a.state = viewTransactions
		return a, nil
	case "up", "k":
		if a.settingsCursor > 0 {
			a.settingsCursor--
		}
	case "down", "j":
		if a.settingsCursor < len(a.categories)-1 {
			a.settingsCursor++
		}
	case "n":
		a.modal = modalNewCategory
		a.settingsMode = settingsModeNew
		a.inputBuffer = ""
		return a, nil
	case "enter":
		if len(a.categories) == 0 {
			a.status = "no categories to rename"
			return a, nil
		}
		a.modal = modalEditCategory
		a.settingsMode = settingsModeRename
		a.editingCategoryID = a.categories[a.settingsCursor].ID
		a.inputBuffer = a.categories[a.settingsCursor].Name
		return a, nil
	case "backspace", "delete":
		if len(a.categories) == 0 {
			return a, nil
		}
		return a, a.deleteCategoryCmd(a.categories[a.settingsCursor])
	case "e":
		a.modal = modalEditAPIKey
		a.settingsMode = settingsModeAPIKey
		a.inputBuffer = a.apiKeyCached
		return a, nil
	case "v":
		a.showAPIKey = !a.showAPIKey
	case "x":
		a.modal = modalConfirmReset
		a.settingsMode = settingsModeConfirm
		return a, nil
	}
	if m.Type == tea.KeyBackspace || m.Type == tea.KeyCtrlH || m.Type == tea.KeyDelete {
		if len(a.categories) == 0 {
			return a, nil
		}
		return a, a.deleteCategoryCmd(a.categories[a.settingsCursor])
	}
	return a, nil
}

func (a *App) categoryByID(id string) *repository.Category {
	for _, c := range a.categories {
		if c.ID == id {
			copy := c
			return &copy
		}
	}
	return nil
}

func (a *App) transactionByID(id string) *repository.Transaction {
	for i := range a.transactions {
		if a.transactions[i].ID == id {
			return &a.transactions[i]
		}
	}
	return nil
}

func (a *App) openTagEditor() {
	if len(a.transactions) == 0 {
		a.status = "no transactions"
		return
	}
	tx := a.transactions[a.txCursor]
	var existing []string
	for _, t := range tx.Tags {
		existing = append(existing, t.Name)
	}
	a.editingTxID = tx.ID
	a.tagInput = strings.Join(existing, ", ")
	a.modal = modalTagEditor
}

// messages
type transactionsMsg []repository.Transaction

type pendingMsg []pendingView

type categoryListMsg []repository.Category

type tagListMsg []repository.Tag

type statusMsg string

type errMsg struct{ error }

type ingestDoneMsg struct {
	Result service.IngestResult
}

// pendingView enriches pending reconciliation with transaction rows.
type pendingView struct {
	PR repository.PendingReconciliation
	A  *repository.Transaction
	B  *repository.Transaction
}

// styles
var titleStyle = lipgloss.NewStyle().Bold(true).Underline(true)

func (a *App) renderImport() string {
	title := titleStyle.Render("Import CSV")
	body := fmt.Sprintf("CSV path: %s\nType a path (e.g. ANZ 040226.csv) and press Enter to ingest into the database.\n[enter] Import  [esc] Back  [q] Quit", a.importPath)
	if a.lastImport != nil {
		body += fmt.Sprintf("\nLast import: %d imported, %d skipped, %d errors", a.lastImport.Imported, a.lastImport.Skipped, len(a.lastImport.Errors))
		if len(a.lastImport.Errors) > 0 {
			body += "\nFirst error: " + a.lastImport.Errors[0].Error()
			if len(a.lastImport.Errors) > 1 {
				body += fmt.Sprintf(" (+%d more)", len(a.lastImport.Errors)-1)
			}
		}
	}
	if a.status != "" {
		body += "\n" + a.status
	}
	return fmt.Sprintf("%s\n%s", title, body)
}

func (a *App) renderDashboard() string {
	title := titleStyle.Render("JaskMoney Dashboard - " + a.month.Format("January 2006"))
	var spend int64
	for _, t := range a.transactions {
		spend += t.AmountCents
	}
	total, uncategorized := len(a.transactions), 0
	for _, t := range a.transactions {
		if t.CategoryID == nil {
			uncategorized++
		}
	}
	body := fmt.Sprintf("Total net: %s%.2f\nTxns: %d  Uncategorized: %d  Pending reconcile: %d", a.currency, float64(spend)/100, total, uncategorized, len(a.pending))

	totals := map[string]int64{}
	for _, t := range a.transactions {
		if t.AmountCents >= 0 {
			continue
		}
		key := a.categoryLabel(t.CategoryID)
		totals[key] += t.AmountCents
	}
	type pair struct {
		name  string
		total int64
	}
	var pairs []pair
	for k, v := range totals {
		pairs = append(pairs, pair{k, v})
	}
	sort.Slice(pairs, func(i, j int) bool { return pairs[i].total < pairs[j].total }) // more negative first
	if len(pairs) > 5 {
		pairs = pairs[:5]
	}
	body += "\nTop categories:"
	for _, p := range pairs {
		body += fmt.Sprintf("\n- %-24s %s%.2f", p.name, a.currency, float64(-p.total)/100)
	}
	body += "\n[t] Transactions  [r] Reconcile  [i] Import CSV  [p] Settings  [q] Quit"
	if a.status != "" {
		body += "\n" + a.status
	}
	return fmt.Sprintf("%s\n%s", title, body)
}

func (a *App) renderTransactions() string {
	title := titleStyle.Render("Transactions")
	out := title + "\n"
	for i, t := range a.transactions {
		marker := " "
		if i == a.txCursor {
			marker = "▶"
		}
		tagText := ""
		if len(t.Tags) > 0 {
			var names []string
			for _, tg := range t.Tags {
				names = append(names, tg.Name)
			}
			tagText = " [" + strings.Join(names, ", ") + "]"
		}
		out += fmt.Sprintf("%s %s  %-40s  %8.2f  %s%s\n", marker, t.Date.In(a.tz).Format(a.dateFormat), t.RawDescription, float64(t.AmountCents)/100, a.categoryLabel(t.CategoryID), tagText)
	}
	out += "[d] Dashboard  [r] Reconcile  [a] AI categorize  [g] Categorize all  [c] Pick category  [t] Tags  [i] Import CSV  [p] Settings  [q] Quit"
	if a.status != "" {
		out += "\n" + a.status
	}
	return out
}

func (a *App) renderReconcile() string {
	title := titleStyle.Render("Reconciliation Queue")
	if len(a.pending) == 0 {
		return fmt.Sprintf("%s\nNo pending matches.\n[d] Dashboard  [t] Transactions  [s] Scan  [i] Import CSV  [p] Settings  [q] Quit", title)
	}
	pv := a.pending[a.recCursor]
	aDesc, bDesc := "<missing>", "<missing>"
	aAmt, bAmt := 0.0, 0.0
	if pv.A != nil {
		aDesc = pv.A.RawDescription
		aAmt = float64(pv.A.AmountCents) / 100
	}
	if pv.B != nil {
		bDesc = pv.B.RawDescription
		bAmt = float64(pv.B.AmountCents) / 100
	}
	aCat, bCat := a.categoryLabel(nil), a.categoryLabel(nil)
	if pv.A != nil {
		aCat = a.categoryLabel(pv.A.CategoryID)
	}
	if pv.B != nil {
		bCat = a.categoryLabel(pv.B.CategoryID)
	}
	out := fmt.Sprintf("%s\nMatch %d of %d  Similarity: %.2f\nA: %-40s %8.2f  %s\nB: %-40s %8.2f  %s\n[y] Merge  [n] Not duplicate  [s] Scan  [d] Dashboard  [t] Transactions  [i] Import CSV  [p] Settings  [q] Quit", title, a.recCursor+1, len(a.pending), pv.PR.Similarity, aDesc, aAmt, aCat, bDesc, bAmt, bCat)
	if pv.PR.LLMConfidence != nil {
		out += fmt.Sprintf("\nAI confidence: %.2f", *pv.PR.LLMConfidence)
	}
	if pv.PR.LLMReasoning != nil {
		out += fmt.Sprintf("\nAI reasoning: %s", *pv.PR.LLMReasoning)
	}
	if a.status != "" {
		out += "\n" + a.status
	}
	return out
}

func (a *App) renderSettings() string {
	title := titleStyle.Render("Settings")
	out := title + "\n"
	out += "Categories (manual control)\n"
	if len(a.categories) == 0 {
		out += "  (no categories yet)\n"
	} else {
		for i, c := range a.categories {
			marker := " "
			if i == a.settingsCursor {
				marker = "▶"
			}
			out += fmt.Sprintf("%s %s\n", marker, c.Name)
		}
	}
	out += "\n[n] New  [enter] Rename  [del] Delete\n"

	apiValue := "(not set)"
	if a.apiKeyCached != "" {
		if a.showAPIKey {
			apiValue = a.apiKeyCached
		} else {
			apiValue = strings.Repeat("*", len(a.apiKeyCached))
		}
	}
	out += fmt.Sprintf("LLM API key (%s): %s\n", a.cfg.LLM.APIKeyEnv, apiValue)
	out += "[e] Edit API key (stored in config)  [v] Toggle visibility\n"
	out += "\n[x] Reset database (clears everything)\n"
	out += "[d] Dashboard  [t] Transactions  [q] Quit"
	if a.status != "" {
		out += "\n" + a.status
	}
	return out
}

func (a *App) renderModal() string {
	switch a.modal {
	case modalCategoryPicker:
		out := titleStyle.Render("Select Category") + "\n"
		options := []string{"[none] (clear category)"}
		for _, c := range a.categories {
			label := c.Name
			if c.ParentID != nil {
				parent := a.categoryName[*c.ParentID]
				if parent != "" {
					label = parent + " > " + c.Name
				}
			}
			options = append(options, label)
		}
		for i, opt := range options {
			marker := " "
			if i == a.categoryCursor {
				marker = "▶"
			}
			out += fmt.Sprintf("%s %s\n", marker, opt)
		}
		out += "[enter] Select  [esc] Cancel"
		return out
	case modalConfirmReset:
		return titleStyle.Render("Reset database?") + "\nThis will delete all data.\n[y] Yes  [n] No"
	case modalNewCategory:
		return titleStyle.Render("New category") + fmt.Sprintf("\n%s\n[enter] Save  [esc] Cancel", a.inputBuffer)
	case modalEditCategory:
		return titleStyle.Render("Rename category") + fmt.Sprintf("\n%s\n[enter] Save  [esc] Cancel", a.inputBuffer)
	case modalEditAPIKey:
		return titleStyle.Render("Set LLM API key (stored in config.toml)") + fmt.Sprintf("\n%s\n[enter] Save  [esc] Cancel", a.inputBuffer)
	case modalTagEditor:
		return titleStyle.Render("Edit tags (comma-separated)") + fmt.Sprintf("\n%s\n[enter] Save  [esc] Cancel", a.tagInput)
	default:
		return ""
	}
}

func (a *App) categoryLabel(id *string) string {
	if id == nil {
		return "[uncategorized]"
	}
	if name, ok := a.categoryName[*id]; ok && name != "" {
		return name
	}
	return *id
}

func normalizeTags(input string) []string {
	raw := strings.FieldsFunc(input, func(r rune) bool {
		return r == ',' || r == ';' || r == ' ' || r == '\t' || r == '\n'
	})
	seen := map[string]struct{}{}
	var out []string
	for _, part := range raw {
		p := strings.TrimSpace(strings.ToLower(part))
		if p == "" {
			continue
		}
		if _, ok := seen[p]; ok {
			continue
		}
		seen[p] = struct{}{}
		out = append(out, p)
	}
	return out
}
