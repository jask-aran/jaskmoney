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

	"github.com/jask/jaskmoney/internal/database/repository"
	"github.com/jask/jaskmoney/internal/service"
)

// App ties together views.
type App struct {
	ctx          context.Context
	repos        Repos
	services     Services
	state        appState
	transactions []repository.Transaction
	pending      []pendingView
	categories   map[string]string // id -> name
	txCursor     int
	recCursor    int
	month        time.Time
	status       string
	tz           *time.Location

	// import flow
	importPath  string
	lastImport  *service.IngestResult
	defaultAcct string
}

type Repos struct {
	Transactions *repository.TransactionRepo
	Categories   *repository.CategoryRepo
	Pending      *repository.ReconciliationRepo
}

type Services struct {
	Categorizer *service.CategorizerService
	Reconciler  *service.Reconciler
	Ingest      *service.IngestService
}

type appState string

const (
	viewDashboard    appState = "dashboard"
	viewTransactions appState = "transactions"
	viewReconcile    appState = "reconcile"
	viewImport       appState = "import"
)

func New(ctx context.Context, repos Repos, services Services, tz *time.Location) *App {
	if tz == nil {
		tz = time.Local
	}
	return &App{
		ctx:         ctx,
		repos:       repos,
		services:    services,
		month:       time.Now().UTC(),
		tz:          tz,
		importPath:  "ANZ 040226.csv",
		defaultAcct: "ANZ",
	}
}

func (a *App) Init() tea.Cmd {
	return tea.Batch(a.loadTransactions(), a.loadPending(), a.loadCategories())
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
		m := make(map[string]string, len(cats))
		for _, c := range cats {
			m[c.ID] = c.Name
		}
		return categoriesMsg(m)
	}
}

func (a *App) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
	switch m := msg.(type) {
	case tea.KeyMsg:
		if a.state == viewImport {
			return a.handleImportKey(m)
		}
		switch m.String() {
		case "q", "ctrl+c":
			return a, tea.Quit
		case "t":
			a.state = viewTransactions
		case "d":
			a.state = viewDashboard
		case "r":
			a.state = viewReconcile
		case "i":
			a.state = viewImport
			a.status = ""
		case "up", "k":
			if a.state == viewTransactions && a.txCursor > 0 {
				a.txCursor--
			}
			if a.state == viewReconcile && a.recCursor > 0 {
				a.recCursor--
			}
		case "down", "j":
			if a.state == viewTransactions && a.txCursor < len(a.transactions)-1 {
				a.txCursor++
			}
			if a.state == viewReconcile && a.recCursor < len(a.pending)-1 {
				a.recCursor++
			}
		case "a":
			if a.state == viewTransactions && len(a.transactions) > 0 {
				tx := a.transactions[a.txCursor]
				return a, a.categorizeCmd(tx)
			}
		case "g":
			if a.state == viewTransactions {
				return a, a.categorizeAllCmd()
			}
		case "s":
			if a.state == viewReconcile {
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
	case categoriesMsg:
		a.categories = map[string]string(m)
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
	switch a.state {
	case viewTransactions:
		return renderTransactions(a.transactions, a.categories, a.txCursor, a.status)
	case viewReconcile:
		return renderReconcile(a.pending, a.recCursor, a.categories, a.status)
	case viewImport:
		return renderImport(a.importPath, a.lastImport, a.status)
	default:
		return renderDashboard(a.month, a.transactions, a.pending, a.categories, a.status)
	}
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

// messages
type transactionsMsg []repository.Transaction

type pendingMsg []pendingView

type categoriesMsg map[string]string

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

func renderImport(path string, last *service.IngestResult, status string) string {
	title := titleStyle.Render("Import CSV")
	body := fmt.Sprintf("CSV path: %s\nType a path (e.g. ANZ 040226.csv) and press Enter to ingest into the database.\n[enter] Import  [esc] Back  [q] Quit", path)
	if last != nil {
		body += fmt.Sprintf("\nLast import: %d imported, %d skipped, %d errors", last.Imported, last.Skipped, len(last.Errors))
		if len(last.Errors) > 0 {
			body += "\nFirst error: " + last.Errors[0].Error()
			if len(last.Errors) > 1 {
				body += fmt.Sprintf(" (+%d more)", len(last.Errors)-1)
			}
		}
	}
	if status != "" {
		body += "\n" + status
	}
	return fmt.Sprintf("%s\n%s", title, body)
}

func renderDashboard(month time.Time, txs []repository.Transaction, pending []pendingView, categories map[string]string, status string) string {
	title := titleStyle.Render("JaskMoney Dashboard - " + month.Format("January 2006"))
	var spend int64
	for _, t := range txs {
		spend += t.AmountCents
	}
	total, uncategorized := len(txs), 0
	for _, t := range txs {
		if t.CategoryID == nil {
			uncategorized++
		}
	}
	body := fmt.Sprintf("Total net: $%.2f\nTxns: %d  Uncategorized: %d  Pending reconcile: %d", float64(spend)/100, total, uncategorized, len(pending))
	// top categories (expenses only, most negative)
	totals := map[string]int64{}
	for _, t := range txs {
		if t.AmountCents >= 0 {
			continue
		}
		key := "[uncategorized]"
		if t.CategoryID != nil {
			if name, ok := categories[*t.CategoryID]; ok {
				key = name
			} else {
				key = *t.CategoryID
			}
		}
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
		body += fmt.Sprintf("\n- %-24s $%.2f", p.name, float64(-p.total)/100)
	}
	body += "\n[t] Transactions  [r] Reconcile  [i] Import CSV  [q] Quit"
	if status != "" {
		body += "\n" + status
	}
	return fmt.Sprintf("%s\n%s", title, body)
}

func renderTransactions(txs []repository.Transaction, categories map[string]string, cursor int, status string) string {
	title := titleStyle.Render("Transactions")
	out := title + "\n"
	for i, t := range txs {
		marker := " "
		if i == cursor {
			marker = "▶"
		}
		cat := "[uncategorized]"
		if t.CategoryID != nil {
			if name, ok := categories[*t.CategoryID]; ok {
				cat = name
			} else {
				cat = *t.CategoryID
			}
		}
		out += fmt.Sprintf("%s %s  %-30s  %8.2f  %s\n", marker, t.Date.Format("01/02"), t.RawDescription, float64(t.AmountCents)/100, cat)
	}
	out += "[d] Dashboard  [r] Reconcile  [a] AI categorize  [g] Categorize all  [i] Import CSV  [q] Quit"
	if status != "" {
		out += "\n" + status
	}
	return out
}

func renderReconcile(pending []pendingView, cursor int, categories map[string]string, status string) string {
	title := titleStyle.Render("Reconciliation Queue")
	if len(pending) == 0 {
		return fmt.Sprintf("%s\nNo pending matches.\n[d] Dashboard  [t] Transactions  [s] Scan  [i] Import CSV  [q] Quit", title)
	}
	pv := pending[cursor]
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
	aCat, bCat := "[uncategorized]", "[uncategorized]"
	if pv.A != nil && pv.A.CategoryID != nil {
		if name, ok := categories[*pv.A.CategoryID]; ok && name != "" {
			aCat = name
		} else {
			aCat = *pv.A.CategoryID
		}
	}
	if pv.B != nil && pv.B.CategoryID != nil {
		if name, ok := categories[*pv.B.CategoryID]; ok && name != "" {
			bCat = name
		} else {
			bCat = *pv.B.CategoryID
		}
	}
	out := fmt.Sprintf("%s\nMatch %d of %d  Similarity: %.2f\nA: %-40s %8.2f  %s\nB: %-40s %8.2f  %s\n[y] Merge  [n] Not duplicate  [s] Scan  [d] Dashboard  [t] Transactions  [i] Import CSV  [q] Quit", title, cursor+1, len(pending), pv.PR.Similarity, aDesc, aAmt, aCat, bDesc, bAmt, bCat)
	if pv.PR.LLMConfidence != nil {
		out += fmt.Sprintf("\nAI confidence: %.2f", *pv.PR.LLMConfidence)
	}
	if pv.PR.LLMReasoning != nil {
		out += fmt.Sprintf("\nAI reasoning: %s", *pv.PR.LLMReasoning)
	}
	if status != "" {
		out += "\n" + status
	}
	return out
}
