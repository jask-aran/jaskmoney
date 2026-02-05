package tui

import (
	"context"
	"errors"
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
	"github.com/jask/jaskmoney/internal/llm"
	"github.com/jask/jaskmoney/internal/prefs"
	"github.com/jask/jaskmoney/internal/secrets"
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
	inputBuffer       string
	editingCategoryID string
	editingTxID       string
	apiKeys           map[string]string // provider -> key
	apiKeyCached      string
	providerCursor    int
	showAPIKey        bool
	currency          string
	dateFormat        string
	width             int
	height            int
	aiPendingTx       map[string]bool
	aiPendingOther    int
	aiSpinnerIndex    int
	aiSpinnerActive   bool
	txFilter          string
	txFilterActive    bool
	monthFilterOn     bool
	modelOptions      []string
	modelCursor       int

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
	modalProviderPicker modalState = "providerPicker"
	modalTagEditor      modalState = "tagEditor"
	modalModelPicker    modalState = "modelPicker"
)

func New(ctx context.Context, cfg config.Config, repos Repos, services Services, tz *time.Location) *App {
	if tz == nil {
		tz = time.Local
	}
	apiKeys := map[string]string{}
	apiKey := loadAPIKey(cfg.LLM.Provider, cfg)
	apiKeys[strings.ToLower(cfg.LLM.Provider)] = apiKey
	return &App{
		ctx:          ctx,
		repos:        repos,
		services:     services,
		cfg:          cfg,
		state:        viewDashboard,
		month:        time.Now().UTC(),
		tz:           tz,
		importPath:   "ANZ 040226.csv",
		defaultAcct:  "ANZ",
		apiKeys:      apiKeys,
		apiKeyCached: apiKey,
		currency:     cfg.UI.CurrencySymbol,
		dateFormat:   cfg.UI.DateFormat,
		aiPendingTx:  map[string]bool{},
	}
}

func loadAPIKey(provider string, cfg config.Config) string {
	p := strings.ToLower(strings.TrimSpace(provider))
	env := strings.TrimSpace(cfg.LLM.APIKeyEnv)
	if env == "" {
		if p == "openai" {
			env = "OPENAI_API_KEY"
		} else {
			env = "GEMINI_API_KEY"
		}
	}
	if p == "openai" && env == "GEMINI_API_KEY" {
		env = "OPENAI_API_KEY"
	}
	if v := os.Getenv(env); v != "" {
		return v
	}
	if key, err := secrets.FetchProviderKey(p); err == nil {
		return key
	}
	return strings.TrimSpace(cfg.LLM.APIKey)
}

func (a *App) Init() tea.Cmd {
	return tea.Batch(a.loadTransactions(), a.loadPending(), a.loadCategories(), a.loadTags())
}

func (a *App) loadTransactions() tea.Cmd {
	return func() tea.Msg {
		filters := repository.TransactionFilters{}
		if a.monthFilterOn {
			filters.Month = a.month
		}
		list, err := a.repos.Transactions.List(a.ctx, filters)
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
		_ = prefs.SaveCategories(cats)
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
		if a.isTxView() && a.txFilterActive {
			return a.handleTxFilterKey(m)
		}
		switch m.String() {
		case "q", "ctrl+c":
			return a, tea.Quit
		case "t":
			if a.isTxView() {
				a.openTagEditor()
			} else {
				a.state = viewDashboard
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
			if a.isTxView() && a.txCursor > 0 {
				a.txCursor--
			}
			if a.state == viewReconcile && a.recCursor > 0 {
				a.recCursor--
			}
			if a.state == viewSettings && a.settingsCursor > 0 {
				a.settingsCursor--
			}
		case "down", "j":
			if a.isTxView() {
				max := len(a.filteredTxIndices()) - 1
				if a.txCursor < max {
					a.txCursor++
				}
			}
			if a.state == viewReconcile && a.recCursor < len(a.pending)-1 {
				a.recCursor++
			}
			if a.state == viewSettings && a.settingsCursor < len(a.categories)-1 {
				a.settingsCursor++
			}
		case "a":
			if a.isTxView() {
				tx := a.currentTx()
				if tx == nil {
					return a, nil
				}
				a.status = "categorizing..."
				startCmd := a.startAIPendingTx(tx.ID)
				return a, tea.Batch(a.categorizeCmd(*tx), startCmd)
			}
		case "g":
			if a.isTxView() {
				a.status = "categorizing..."
				startCmd := a.startAIPendingAll()
				return a, tea.Batch(a.categorizeAllCmd(), startCmd)
			}
		case "s":
			if a.state == viewReconcile {
				a.status = "scanning..."
				startCmd := a.startAIPendingOther()
				return a, tea.Batch(a.detectCmd(), startCmd)
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
			if a.isTxView() {
				a.modal = modalCategoryPicker
				if a.categoryCursor >= len(a.categories)+1 {
					a.categoryCursor = 0
				}
			}
		case "/":
			if a.isTxView() {
				a.txFilterActive = true
			}
		case "<", "[":
			return a.changeMonth(-1)
		case ">", "]":
			return a.changeMonth(1)
		case "0":
			return a.clearMonthFilter()
		}
	case transactionsMsg:
		a.transactions = []repository.Transaction(m)
		if a.txCursor >= len(a.filteredTxIndices()) {
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
		a.state = viewDashboard
		return a, tea.Batch(a.loadTransactions(), a.loadPending())
	case categorizeDoneMsg:
		a.finishAIPendingTx(m.txID)
		if m.err != nil {
			a.status = "categorize failed: " + m.err.Error()
		} else {
			a.status = "categorized"
		}
		return a, a.loadTransactions()
	case detectDoneMsg:
		a.finishAIPendingOther()
		if m.err != nil {
			a.status = "scan failed: " + m.err.Error()
		} else {
			a.status = "scan complete"
		}
		return a, a.loadPending()
	case spinnerMsg:
		if a.aiPendingCount() == 0 {
			a.aiSpinnerActive = false
			return a, nil
		}
		a.aiSpinnerIndex = (a.aiSpinnerIndex + 1) % len(aiSpinnerFrames)
		return a, a.tickSpinner()
	case modelListMsg:
		a.modelOptions = []string(m)
		if a.modelCursor >= len(a.modelOptions) {
			a.modelCursor = 0
		}
		a.modal = modalModelPicker
	case tea.WindowSizeMsg:
		a.width = m.Width
		a.height = m.Height
	}
	return a, nil
}

func (a *App) View() string {
	var body string
	var title string
	switch a.state {
	case viewTransactions:
		fallthrough
	default:
		title = "Dashboard"
		body = a.renderDashboard()
	case viewReconcile:
		title = "Reconciliation"
		body = a.renderReconcile()
	case viewImport:
		title = "Import"
		body = a.renderImport()
	case viewSettings:
		title = "Settings"
		body = a.renderSettings()
	}
	if a.modal != modalNone {
		body = a.renderModalOverlay(body)
	}
	return a.renderFrame(title, body)
}

// commands
func (a *App) categorizeCmd(tx repository.Transaction) tea.Cmd {
	return func() tea.Msg {
		err := a.services.Categorizer.CategorizeTransaction(a.ctx, tx, true)
		return categorizeDoneMsg{txID: tx.ID, err: err}
	}
}

func (a *App) categorizeAllCmd() tea.Cmd {
	cmds := make([]tea.Cmd, 0, len(a.transactions))
	for _, tx := range a.transactions {
		local := tx
		cmds = append(cmds, func() tea.Msg {
			err := a.services.Categorizer.CategorizeTransaction(a.ctx, local, false)
			return categorizeDoneMsg{txID: local.ID, err: err}
		})
	}
	return tea.Batch(cmds...)
}

func (a *App) detectCmd() tea.Cmd {
	return func() tea.Msg {
		err := a.services.Reconciler.DetectAndQueue(a.ctx)
		return detectDoneMsg{err: err}
	}
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
		a.saveCategoriesPrefs(),
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
		a.saveCategoriesPrefs(),
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
		a.saveCategoriesPrefs(),
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
		a.saveCategoriesPrefs(),
	)
}

func (a *App) saveAPIKeyCmd(key string) tea.Cmd {
	return func() tea.Msg {
		provider := strings.ToLower(strings.TrimSpace(a.cfg.LLM.Provider))
		trimmed := strings.TrimSpace(key)
		if trimmed == "" {
			_ = secrets.DeleteProviderKey(provider)
			delete(a.apiKeys, provider)
			a.apiKeyCached = ""
			a.updateProviderAPIKey("")
			_ = config.Save(a.cfg)
			return statusMsg("API key cleared")
		}
		if err := secrets.StoreProviderKey(provider, trimmed); err != nil {
			return errMsg{err}
		}
		a.apiKeys[provider] = trimmed
		a.apiKeyCached = trimmed
		a.cfg.LLM.APIKey = ""
		if err := config.Save(a.cfg); err != nil {
			return errMsg{err}
		}
		a.updateProviderAPIKey(trimmed)
		return statusMsg("API key saved securely")
	}
}

func (a *App) listModelsCmd(announce bool) tea.Cmd {
	if announce {
		a.status = "fetching models..."
	}
	return func() tea.Msg {
		lister := a.modelLister()
		if lister == nil {
			return errMsg{fmt.Errorf("llm provider does not support model listing")}
		}
		models, err := lister.ListModels(a.ctx)
		if err != nil {
			if errors.Is(err, llm.ErrNoAPIKey) || errors.Is(err, llm.ErrOpenAINoAPIKey) {
				return statusMsg("set LLM API key to list models")
			}
			return errMsg{err}
		}
		sort.Strings(models)
		return modelListMsg(models)
	}
}

func (a *App) saveModelCmd(model string) tea.Cmd {
	return tea.Batch(
		func() tea.Msg {
			selected := strings.TrimSpace(model)
			if selected == "" {
				return errMsg{fmt.Errorf("model cannot be empty")}
			}
			a.cfg.LLM.Model = selected
			if err := config.Save(a.cfg); err != nil {
				return errMsg{err}
			}
			a.updateProviderModel(selected)
			return statusMsg("LLM model saved and applied")
		},
	)
}

func (a *App) setProviderCmd(provider string) tea.Cmd {
	return func() tea.Msg {
		p := strings.ToLower(strings.TrimSpace(provider))
		if p == "" {
			return errMsg{fmt.Errorf("provider required")}
		}
		key := a.apiKeys[p]
		if key == "" {
			key = loadAPIKey(p, a.cfg)
			if key != "" {
				a.apiKeys[p] = key
			}
		}
		prov := buildProvider(p, key, a.cfg.LLM.Model)
		if prov == nil {
			return errMsg{fmt.Errorf("unknown provider %s", p)}
		}
		a.services.Categorizer.Provider = prov
		a.services.Reconciler.Provider = prov
		a.cfg.LLM.Provider = p
		if p == "openai" {
			a.cfg.LLM.APIKeyEnv = "OPENAI_API_KEY"
		} else {
			a.cfg.LLM.APIKeyEnv = "GEMINI_API_KEY"
		}
		a.apiKeyCached = key
		if err := config.Save(a.cfg); err != nil {
			return errMsg{err}
		}
		return statusMsg("Provider set to " + p)
	}
}

type apiKeySetter interface {
	SetAPIKey(string)
}

type modelSetter interface {
	SetModel(string)
}

type modelLister interface {
	ListModels(context.Context) ([]string, error)
}

func (a *App) updateProviderAPIKey(key string) {
	if a.services.Categorizer != nil {
		if setter, ok := a.services.Categorizer.Provider.(apiKeySetter); ok {
			setter.SetAPIKey(key)
		}
	}
	if a.services.Reconciler != nil {
		if setter, ok := a.services.Reconciler.Provider.(apiKeySetter); ok {
			setter.SetAPIKey(key)
		}
	}
}

func (a *App) updateProviderModel(model string) {
	if a.services.Categorizer != nil {
		if setter, ok := a.services.Categorizer.Provider.(modelSetter); ok {
			setter.SetModel(model)
		}
	}
	if a.services.Reconciler != nil {
		if setter, ok := a.services.Reconciler.Provider.(modelSetter); ok {
			setter.SetModel(model)
		}
	}
}

func (a *App) modelLister() modelLister {
	if a.services.Categorizer != nil {
		if lister, ok := a.services.Categorizer.Provider.(modelLister); ok {
			return lister
		}
	}
	if a.services.Reconciler != nil {
		if lister, ok := a.services.Reconciler.Provider.(modelLister); ok {
			return lister
		}
	}
	return nil
}

func buildProvider(name, apiKey, model string) llm.LLMProvider {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "openai":
		return llm.NewOpenAIProvider(apiKey, model)
	default:
		return llm.NewGeminiProvider(apiKey, model)
	}
}

func (a *App) saveCategoriesPrefs() tea.Cmd {
	return func() tea.Msg {
		cats, err := a.repos.Categories.List(a.ctx)
		if err != nil {
			return errMsg{err}
		}
		if err := prefs.SaveCategories(cats); err != nil {
			return errMsg{err}
		}
		return nil
	}
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

func (a *App) changeMonth(delta int) (tea.Model, tea.Cmd) {
	if !a.monthFilterOn {
		a.monthFilterOn = true
	}
	a.month = a.month.AddDate(0, delta, 0)
	a.txCursor = 0
	return a, tea.Batch(a.loadTransactions(), a.loadPending())
}

func (a *App) clearMonthFilter() (tea.Model, tea.Cmd) {
	a.monthFilterOn = false
	a.txCursor = 0
	return a, tea.Batch(a.loadTransactions(), a.loadPending())
}

func (a *App) handleTxFilterKey(m tea.KeyMsg) (tea.Model, tea.Cmd) {
	switch m.Type {
	case tea.KeyEsc:
		a.txFilterActive = false
	case tea.KeyEnter:
		a.txFilterActive = false
	case tea.KeyBackspace, tea.KeyCtrlH, tea.KeyDelete:
		if len(a.txFilter) > 0 {
			a.txFilter = a.txFilter[:len(a.txFilter)-1]
		}
	case tea.KeyCtrlU:
		a.txFilter = ""
	case tea.KeySpace:
		a.txFilter += " "
	case tea.KeyRunes:
		a.txFilter += string(m.Runes)
	}
	if a.txCursor >= len(a.filteredTxIndices()) {
		a.txCursor = 0
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
			tx := a.currentTx()
			if tx == nil {
				a.modal = modalNone
				return a, nil
			}
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
				return a, a.createCategoryCmd(text)
			case modalEditCategory:
				cat := a.categoryByID(a.editingCategoryID)
				if cat == nil {
					return a, nil
				}
				return a, a.renameCategoryCmd(*cat, text)
			case modalEditAPIKey:
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
	case modalModelPicker:
		switch m.String() {
		case "esc":
			a.modal = modalNone
		case "up", "k":
			if a.modelCursor > 0 {
				a.modelCursor--
			}
		case "down", "j":
			if a.modelCursor < len(a.modelOptions)-1 {
				a.modelCursor++
			}
		case "r":
			return a, a.listModelsCmd(false)
		case "enter":
			if len(a.modelOptions) == 0 {
				a.modal = modalNone
				return a, nil
			}
			selected := a.modelOptions[a.modelCursor]
			a.modal = modalNone
			return a, a.saveModelCmd(selected)
		}
	case modalProviderPicker:
		switch m.String() {
		case "esc":
			a.modal = modalNone
		case "up", "k":
			if a.providerCursor > 0 {
				a.providerCursor--
			}
		case "down", "j":
			if a.providerCursor < len(providerOptions)-1 {
				a.providerCursor++
			}
		case "enter":
			selected := providerOptions[a.providerCursor]
			a.modal = modalNone
			return a, a.setProviderCmd(selected)
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
		a.inputBuffer = ""
		return a, nil
	case "enter":
		if len(a.categories) == 0 {
			a.status = "no categories to rename"
			return a, nil
		}
		a.modal = modalEditCategory
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
		a.inputBuffer = a.apiKeyCached
		return a, nil
	case "o":
		a.modal = modalProviderPicker
		return a, nil
	case "m":
		return a, a.listModelsCmd(true)
	case "v":
		a.showAPIKey = !a.showAPIKey
	case "x":
		a.modal = modalConfirmReset
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

func (a *App) isTxView() bool {
	return a.state == viewDashboard || a.state == viewTransactions
}

func (a *App) keyStatus(provider string) string {
	if key := a.apiKeys[strings.ToLower(provider)]; strings.TrimSpace(key) != "" {
		return "set"
	}
	return "missing"
}

func (a *App) openTagEditor() {
	tx := a.currentTx()
	if tx == nil {
		a.status = "no transactions"
		return
	}
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

type modelListMsg []string

type categorizeDoneMsg struct {
	txID string
	err  error
}

type detectDoneMsg struct {
	err error
}

type spinnerMsg struct{}

// pendingView enriches pending reconciliation with transaction rows.
type pendingView struct {
	PR repository.PendingReconciliation
	A  *repository.Transaction
	B  *repository.Transaction
}

var providerOptions = []string{"gemini", "openai"}

// styles
var (
	colorInk       = lipgloss.AdaptiveColor{Light: "#0F172A", Dark: "#E2E8F0"}
	colorMuted     = lipgloss.AdaptiveColor{Light: "#64748B", Dark: "#94A3B8"}
	colorAccent    = lipgloss.Color("#06B6D4")
	colorAccentDim = lipgloss.Color("#22D3EE")
	colorSuccess   = lipgloss.Color("#10B981")
	colorWarn      = lipgloss.Color("#F59E0B")
	colorDanger    = lipgloss.Color("#F43F5E")
	colorSurface   = lipgloss.AdaptiveColor{Light: "#F8FAFC", Dark: "#0F172A"}
	colorSurfaceHi = lipgloss.AdaptiveColor{Light: "#E2E8F0", Dark: "#111827"}
	colorBorder    = lipgloss.AdaptiveColor{Light: "#CBD5E1", Dark: "#334155"}
	colorSelect    = lipgloss.AdaptiveColor{Light: "#DBEAFE", Dark: "#1E3A8A"}

	panelBorder = lipgloss.Border{
		Top:         "━",
		Bottom:      "━",
		Left:        "┃",
		Right:       "┃",
		TopLeft:     "┏",
		TopRight:    "┓",
		BottomLeft:  "┗",
		BottomRight: "┛",
	}

	baseStyle   = lipgloss.NewStyle().Foreground(colorInk)
	headerStyle = lipgloss.NewStyle().Foreground(colorInk).Padding(0, 1).Border(lipgloss.Border{Bottom: "─"}, false, false, true, false).BorderForeground(colorBorder)
	footerStyle = lipgloss.NewStyle().Foreground(colorMuted).Padding(0, 1).Border(lipgloss.Border{Top: "─"}, true, false, false, false).BorderForeground(colorBorder)
	panelStyle  = lipgloss.NewStyle().Border(panelBorder).BorderForeground(colorBorder).Padding(0, 1)
	titleStyle  = lipgloss.NewStyle().Bold(true).Foreground(colorInk)
	accentStyle = lipgloss.NewStyle().Bold(true).Foreground(colorAccent)
	mutedStyle  = lipgloss.NewStyle().Foreground(colorMuted)
	cursorStyle = lipgloss.NewStyle().Bold(true).Foreground(colorAccent)
	chipStyle   = lipgloss.NewStyle().Foreground(colorInk).Background(colorAccent).Padding(0, 1).Bold(true)
	negStyle    = lipgloss.NewStyle().Foreground(colorDanger)
	posStyle    = lipgloss.NewStyle().Foreground(colorSuccess)
	rowStyle    = lipgloss.NewStyle().Background(colorSelect).Foreground(colorInk)
)

func (a *App) renderImport() string {
	body := accentStyle.Render("CSV import") + fmt.Sprintf("\nCSV path: %s\nType a path (e.g. ANZ 040226.csv) and press Enter to ingest into the database.", a.importPath)
	if a.lastImport != nil {
		body += fmt.Sprintf("\nLast import: %d imported, %d skipped, %d errors", a.lastImport.Imported, a.lastImport.Skipped, len(a.lastImport.Errors))
		if len(a.lastImport.Errors) > 0 {
			body += "\nFirst error: " + a.lastImport.Errors[0].Error()
			if len(a.lastImport.Errors) > 1 {
				body += fmt.Sprintf(" (+%d more)", len(a.lastImport.Errors)-1)
			}
		}
	}
	return panelStyle.Width(a.contentWidth()).Render(body)
}

func (a *App) renderDashboard() string {
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
	net := float64(spend) / 100
	netLabel := fmt.Sprintf("%s%.2f", a.currency, net)
	if net < 0 {
		netLabel = negStyle.Render(netLabel)
	} else {
		netLabel = posStyle.Render(netLabel)
	}
	statLine := accentStyle.Render("Overview") + fmt.Sprintf("\nNet: %s\nTransactions: %d  Uncategorized: %d  Pending reconcile: %d", netLabel, total, uncategorized, len(a.pending))

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
	left := panelStyle.Width(a.contentWidth()/2 - 2).Render(statLine)
	catLines := accentStyle.Render("Top categories")
	for _, p := range pairs {
		bar := renderBar(int(float64(-p.total) / maxFloat(float64(-pairs[0].total), 1) * 16))
		catLines += fmt.Sprintf("\n%-20s %s%.2f %s", truncate(p.name, 20), a.currency, float64(-p.total)/100, bar)
	}
	if len(pairs) == 0 {
		catLines += "\n" + mutedStyle.Render("No expenses yet")
	}
	right := panelStyle.Width(a.contentWidth()/2 - 2).Render(catLines)
	row := lipgloss.JoinHorizontal(lipgloss.Top, left, right)

	overviewLines := countLines(row)
	bodyHeight := a.bodyHeight("Dashboard")
	spacerLines := 1
	txPaneHeight := 0
	if bodyHeight > 0 {
		txPaneHeight = bodyHeight - overviewLines - spacerLines
		if txPaneHeight < 0 {
			txPaneHeight = 0
		}
	}
	txPanel := a.renderTransactions(txPaneHeight)

	return lipgloss.JoinVertical(lipgloss.Left, row, "", txPanel)
}

func (a *App) renderTransactions(paneHeight int) string {
	width := a.contentWidth()
	colDate := 6
	colAmt := 12
	colCat := 20
	innerWidth := max(20, width-4)
	colDesc := max(20, innerWidth-colDate-colAmt-colCat-6)
	filtered := a.filteredTxIndices()
	if len(filtered) == 0 {
		return panelStyle.Width(a.contentWidth()).Render("No transactions yet. Press [i] to import.")
	}
	if a.txCursor >= len(filtered) {
		a.txCursor = len(filtered) - 1
	}
	if a.txCursor < 0 {
		a.txCursor = 0
	}
	filterLabel := "(none)"
	if strings.TrimSpace(a.txFilter) != "" {
		filterLabel = a.txFilter
	}
	filterState := ""
	if a.txFilterActive {
		filterState = " [editing]"
	}
	period := "All time"
	if a.monthFilterOn {
		period = a.month.Format("January 2006")
	}
	info := fmt.Sprintf("Period: %s  Showing: %d/%d  AI pending: %d\nFilter: %s%s", period, len(filtered), len(a.transactions), a.aiPendingCount(), filterLabel, filterState)
	header := fmt.Sprintf("%s  %-*s  %-*s  %-*s", mutedStyle.Render("DT"), colDesc, "Description", colCat, "Category", colAmt, "Amount")

	maxTxRows := len(filtered)
	showEllipsis := false
	if paneHeight > 0 {
		// Reserve space for the panel border and fixed lines (info + header).
		contentHeight := paneHeight - 2
		if contentHeight < 0 {
			contentHeight = 0
		}
		slots := contentHeight - 2
		if slots < 0 {
			slots = 0
		}
		if len(filtered) > slots {
			if slots > 0 {
				showEllipsis = true
				maxTxRows = slots - 1
			} else {
				maxTxRows = 0
			}
		} else {
			maxTxRows = len(filtered)
		}
	}
	var rows []string
	rows = append(rows, info, header)
	window := filtered
	if maxTxRows == 0 {
		window = nil
	} else if len(filtered) > maxTxRows {
		start := a.txCursor - maxTxRows/2
		if start < 0 {
			start = 0
		}
		if start+maxTxRows > len(filtered) {
			start = len(filtered) - maxTxRows
		}
		window = filtered[start : start+maxTxRows]
		if paneHeight == 0 {
			showEllipsis = true
		}
	}
	for _, idx := range window {
		t := a.transactions[idx]
		marker := " "
		if filtered[a.txCursor] == idx {
			marker = cursorStyle.Render("▶")
		}
		indicator := a.aiIndicatorForTx(t.ID)
		tagText := ""
		if len(t.Tags) > 0 {
			var names []string
			for _, tg := range t.Tags {
				names = append(names, tg.Name)
			}
			tagText = " [" + strings.Join(names, ", ") + "]"
		}
		desc := truncate(t.RawDescription, colDesc)
		cat := truncate(a.categoryLabel(t.CategoryID), colCat)
		amount := formatMoney(a.currency, t.AmountCents)
		line := fmt.Sprintf("%s %s %s  %-*s  %-*s  %*s%s", marker, indicator, t.Date.In(a.tz).Format(a.dateFormat), colDesc, desc, colCat, cat, colAmt, amount, tagText)
		if filtered[a.txCursor] == idx {
			line = rowStyle.Render(padToWidth(line, innerWidth))
		}
		rows = append(rows, line)
	}
	if showEllipsis && len(filtered) > len(window) {
		rows = append(rows, mutedStyle.Render(fmt.Sprintf("… %d more", len(filtered)-len(window))))
	}
	out := strings.Join(rows, "\n")
	return panelStyle.Width(width).Render(out)
}

func (a *App) renderReconcile() string {
	if len(a.pending) == 0 {
		body := "No pending matches.\nPress [s] to scan or return to the dashboard."
		if a.aiPendingOther > 0 {
			body += "\n" + mutedStyle.Render("AI scan running...")
		}
		return panelStyle.Width(a.contentWidth()).Render(body)
	}
	pv := a.pending[a.recCursor]
	aDesc, bDesc := "<missing>", "<missing>"
	aAmt, bAmt := int64(0), int64(0)
	if pv.A != nil {
		aDesc = pv.A.RawDescription
		aAmt = pv.A.AmountCents
	}
	if pv.B != nil {
		bDesc = pv.B.RawDescription
		bAmt = pv.B.AmountCents
	}
	aCat, bCat := a.categoryLabel(nil), a.categoryLabel(nil)
	if pv.A != nil {
		aCat = a.categoryLabel(pv.A.CategoryID)
	}
	if pv.B != nil {
		bCat = a.categoryLabel(pv.B.CategoryID)
	}
	width := a.contentWidth()
	colWidth := max(30, (width/2)-2)
	left := fmt.Sprintf("%s\n%s\nAmount: %s\nCategory: %s", accentStyle.Render("Transaction A (older)"), truncate(aDesc, colWidth-2), formatMoney(a.currency, aAmt), truncate(aCat, colWidth-2))
	right := fmt.Sprintf("%s\n%s\nAmount: %s\nCategory: %s", accentStyle.Render("Transaction B (newer)"), truncate(bDesc, colWidth-2), formatMoney(a.currency, bAmt), truncate(bCat, colWidth-2))
	row := lipgloss.JoinHorizontal(lipgloss.Top, panelStyle.Width(colWidth).Render(left), panelStyle.Width(colWidth).Render(right))

	content := fmt.Sprintf("%s  Similarity: %.2f", accentStyle.Render(fmt.Sprintf("Match %d of %d", a.recCursor+1, len(a.pending))), pv.PR.Similarity)
	if pv.PR.LLMConfidence != nil {
		content += fmt.Sprintf("  AI: %.2f", *pv.PR.LLMConfidence)
	}
	if pv.PR.LLMReasoning != nil {
		content += fmt.Sprintf("\nReasoning: %s", *pv.PR.LLMReasoning)
	}
	if a.aiPendingOther > 0 {
		content += "\n" + mutedStyle.Render("AI scan running...")
	}
	return lipgloss.JoinVertical(lipgloss.Left, panelStyle.Width(width).Render(content), "", row)
}

func (a *App) renderSettings() string {
	out := accentStyle.Render("Categories") + " " + mutedStyle.Render("(manual control)") + "\n"
	if len(a.categories) == 0 {
		out += "  (no categories yet)\n"
	} else {
		for i, c := range a.categories {
			marker := " "
			if i == a.settingsCursor {
				marker = cursorStyle.Render("▶")
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
	out += fmt.Sprintf("%s: %s\n", accentStyle.Render("Provider"), strings.Title(a.cfg.LLM.Provider))
	out += fmt.Sprintf("%s (%s): %s\n", accentStyle.Render("API key"), a.cfg.LLM.APIKeyEnv, apiValue)
	out += fmt.Sprintf("Gemini key: %s  OpenAI key: %s\n", a.keyStatus("gemini"), a.keyStatus("openai"))
	out += "[o] Switch provider  [e] Edit API key (secure store)  [v] Toggle visibility\n"
	model := strings.TrimSpace(a.cfg.LLM.Model)
	if model == "" {
		model = "(auto)"
	}
	out += fmt.Sprintf("%s: %s\n", accentStyle.Render("LLM model"), model)
	out += "[m] Choose model (requires API key)\n"
	out += "\n[x] Reset database (clears everything)\n"
	out += "[d] Dashboard  [t] Transactions  [q] Quit"
	return panelStyle.Width(a.contentWidth()).Render(out)
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
				marker = cursorStyle.Render("▶")
			}
			out += fmt.Sprintf("%s %s\n", marker, opt)
		}
		out += "[enter] Select  [esc] Cancel"
		return panelStyle.Render(out)
	case modalModelPicker:
		out := titleStyle.Render("Select Model") + "\n"
		if len(a.modelOptions) == 0 {
			out += mutedStyle.Render("No models available. Press [r] to retry.") + "\n"
		}
		maxRows := 10
		if a.height > 0 {
			if v := a.height - 6; v > 3 {
				maxRows = v
			}
		}
		start := 0
		if len(a.modelOptions) > maxRows {
			start = a.modelCursor - maxRows/2
			if start < 0 {
				start = 0
			}
			if start+maxRows > len(a.modelOptions) {
				start = len(a.modelOptions) - maxRows
			}
		}
		end := len(a.modelOptions)
		if end > start+maxRows {
			end = start + maxRows
		}
		for i := start; i < end; i++ {
			opt := a.modelOptions[i]
			marker := " "
			if i == a.modelCursor {
				marker = cursorStyle.Render("▶")
			}
			out += fmt.Sprintf("%s %s\n", marker, opt)
		}
		out += "[enter] Select  [r] Refresh  [esc] Cancel"
		return panelStyle.Render(out)
	case modalProviderPicker:
		out := titleStyle.Render("Select Provider") + "\n"
		for i, opt := range providerOptions {
			marker := " "
			if i == a.providerCursor {
				marker = cursorStyle.Render("▶")
			}
			out += fmt.Sprintf("%s %s\n", marker, strings.Title(opt))
		}
		out += "[enter] Select  [esc] Cancel"
		return panelStyle.Render(out)
	case modalConfirmReset:
		return panelStyle.Render(titleStyle.Render("Reset database?") + "\nThis will delete all data.\n[y] Yes  [n] No")
	case modalNewCategory:
		return panelStyle.Render(titleStyle.Render("New category") + fmt.Sprintf("\n%s\n[enter] Save  [esc] Cancel", a.inputBuffer))
	case modalEditCategory:
		return panelStyle.Render(titleStyle.Render("Rename category") + fmt.Sprintf("\n%s\n[enter] Save  [esc] Cancel", a.inputBuffer))
	case modalEditAPIKey:
		title := fmt.Sprintf("Set %s API key (secure store)", strings.Title(a.cfg.LLM.Provider))
		return panelStyle.Render(titleStyle.Render(title) + fmt.Sprintf("\n%s\n[enter] Save  [esc] Cancel", a.inputBuffer))
	case modalTagEditor:
		return panelStyle.Render(titleStyle.Render("Edit tags (comma-separated)") + fmt.Sprintf("\n%s\n[enter] Save  [esc] Cancel", a.tagInput))
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

func (a *App) renderFrame(viewTitle, body string) string {
	header := a.renderHeader(viewTitle)
	footer := a.renderFooter()
	content := lipgloss.JoinVertical(lipgloss.Left, header, body, footer)
	if a.width > 0 {
		content = lipgloss.NewStyle().Width(a.width).Render(content)
	}
	if a.height > 0 {
		lines := strings.Count(content, "\n") + 1
		if lines < a.height {
			padding := strings.Repeat("\n", a.height-lines)
			content = padding + content
		}
		content = lipgloss.NewStyle().Height(a.height).Align(lipgloss.Bottom).Render(content)
	}
	return baseStyle.Render(content)
}

func (a *App) renderHeader(viewTitle string) string {
	period := "All time"
	if a.monthFilterOn {
		period = a.month.Format("January 2006")
	}
	left := accentStyle.Render("JaskMoney") + mutedStyle.Render("  "+viewTitle)
	right := fmt.Sprintf("%s  %s", mutedStyle.Render(period), a.aiStatusText())
	row := joinColumns(left, right, a.width)
	return headerStyle.Render(row)
}

func (a *App) renderFooter() string {
	status := a.status
	if status == "" {
		status = "Ready"
	}
	keys := a.footerKeys()
	content := lipgloss.JoinVertical(lipgloss.Left, joinColumns(status, "", a.width), joinColumns(keys, "", a.width))
	return footerStyle.Render(content)
}

func (a *App) footerKeys() string {
	switch a.state {
	case viewReconcile:
		return "[↑/↓] Move  [y] Merge  [n] Not dup  [s] Scan  [d] Dashboard  [t] Transactions  [i] Import  [p] Settings  [q] Quit"
	case viewImport:
		return "[enter] Import  [esc] Back  [d] Dashboard  [q] Quit"
	case viewSettings:
		return "[↑/↓] Move  [n] New  [enter] Rename  [del] Delete  [e] API key  [m] Model  [x] Reset  [d] Dashboard  [q] Quit"
	default:
		return "[↑/↓] Move  [/] Filter  [a] AI  [g] AI all  [c] Category  [t] Tags  [</>] Month  [0] All time  [r] Reconcile  [i] Import  [p] Settings  [q] Quit"
	}
}

func (a *App) renderModalOverlay(content string) string {
	modal := a.renderModal()
	return content + "\n\n" + modal
}

func (a *App) contentWidth() int {
	if a.width == 0 {
		return 90
	}
	if a.width < 60 {
		return a.width
	}
	return a.width - 2
}

func (a *App) headerHeight(viewTitle string) int {
	return countLines(a.renderHeader(viewTitle))
}

func (a *App) footerHeight() int {
	return countLines(a.renderFooter())
}

func (a *App) bodyHeight(viewTitle string) int {
	if a.height == 0 {
		return 0
	}
	header := a.headerHeight(viewTitle)
	footer := a.footerHeight()
	body := a.height - header - footer
	if body < 0 {
		return 0
	}
	return body
}

func (a *App) aiPendingCount() int {
	return len(a.aiPendingTx) + a.aiPendingOther
}

func (a *App) aiStatusText() string {
	if strings.TrimSpace(a.apiKeyCached) == "" {
		return chipStyle.Render("AI off")
	}
	count := a.aiPendingCount()
	if count == 0 {
		return chipStyle.Render("AI idle")
	}
	return chipStyle.Render(fmt.Sprintf("AI %s %d", aiSpinnerFrames[a.aiSpinnerIndex], count))
}

func (a *App) aiIndicatorForTx(txID string) string {
	if a.aiPendingTx[txID] {
		return accentStyle.Render(aiSpinnerFrames[a.aiSpinnerIndex])
	}
	return " "
}

func (a *App) startAIPendingTx(txID string) tea.Cmd {
	if a.aiPendingTx[txID] {
		return nil
	}
	a.aiPendingTx[txID] = true
	return a.ensureSpinner()
}

func (a *App) startAIPendingAll() tea.Cmd {
	for _, tx := range a.transactions {
		a.aiPendingTx[tx.ID] = true
	}
	return a.ensureSpinner()
}

func (a *App) finishAIPendingTx(txID string) {
	delete(a.aiPendingTx, txID)
}

func (a *App) startAIPendingOther() tea.Cmd {
	a.aiPendingOther++
	return a.ensureSpinner()
}

func (a *App) finishAIPendingOther() {
	if a.aiPendingOther > 0 {
		a.aiPendingOther--
	}
}

func (a *App) ensureSpinner() tea.Cmd {
	if a.aiSpinnerActive || a.aiPendingCount() == 0 {
		return nil
	}
	a.aiSpinnerActive = true
	return a.tickSpinner()
}

func (a *App) tickSpinner() tea.Cmd {
	return tea.Tick(120*time.Millisecond, func(time.Time) tea.Msg {
		return spinnerMsg{}
	})
}

func joinColumns(left, right string, width int) string {
	if width == 0 {
		return left + "  " + right
	}
	space := width - lipgloss.Width(left) - lipgloss.Width(right)
	if space < 2 {
		return left + "  " + right
	}
	return left + strings.Repeat(" ", space) + right
}

func truncate(text string, limit int) string {
	if limit <= 0 {
		return ""
	}
	runes := []rune(text)
	if len(runes) <= limit {
		return text
	}
	if limit <= 1 {
		return string(runes[:limit])
	}
	if limit <= 3 {
		return string(runes[:limit])
	}
	return string(runes[:limit-3]) + "..."
}

func padToWidth(text string, width int) string {
	if width <= 0 {
		return text
	}
	current := lipgloss.Width(text)
	if current >= width {
		return text
	}
	return text + strings.Repeat(" ", width-current)
}

func formatMoney(symbol string, cents int64) string {
	value := float64(cents) / 100
	formatted := fmt.Sprintf("%s%.2f", symbol, value)
	if value < 0 {
		return negStyle.Render(formatted)
	}
	return posStyle.Render(formatted)
}

func renderBar(size int) string {
	if size <= 0 {
		return mutedStyle.Render("░░░░░░░░░░░░░░░░")
	}
	if size > 16 {
		size = 16
	}
	return accentStyle.Render(strings.Repeat("█", size) + strings.Repeat("░", 16-size))
}

func maxFloat(a, b float64) float64 {
	if a > b {
		return a
	}
	return b
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func (a *App) filteredTxIndices() []int {
	if len(a.transactions) == 0 {
		return nil
	}
	filter := strings.TrimSpace(strings.ToLower(a.txFilter))
	if filter == "" {
		idx := make([]int, 0, len(a.transactions))
		for i := range a.transactions {
			idx = append(idx, i)
		}
		return idx
	}
	var idx []int
	for i, t := range a.transactions {
		if strings.Contains(strings.ToLower(t.RawDescription), filter) {
			idx = append(idx, i)
			continue
		}
		if strings.Contains(strings.ToLower(a.categoryLabel(t.CategoryID)), filter) {
			idx = append(idx, i)
			continue
		}
		for _, tg := range t.Tags {
			if strings.Contains(strings.ToLower(tg.Name), filter) {
				idx = append(idx, i)
				break
			}
		}
	}
	return idx
}

func (a *App) currentTx() *repository.Transaction {
	indices := a.filteredTxIndices()
	if len(indices) == 0 {
		return nil
	}
	cursor := a.txCursor
	if cursor < 0 || cursor >= len(indices) {
		cursor = 0
	}
	idx := indices[cursor]
	return &a.transactions[idx]
}

var aiSpinnerFrames = []string{"⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"}

func countLines(s string) int {
	if s == "" {
		return 0
	}
	return strings.Count(s, "\n") + 1
}
