package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"time"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/google/uuid"

	"github.com/jask/jaskmoney/internal/config"
	"github.com/jask/jaskmoney/internal/database"
	"github.com/jask/jaskmoney/internal/database/repository"
	"github.com/jask/jaskmoney/internal/llm"
	"github.com/jask/jaskmoney/internal/service"
	"github.com/jask/jaskmoney/internal/testdata"
	"github.com/jask/jaskmoney/internal/tui"
)

func main() {
	ctx := context.Background()

	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("config: %v", err)
	}

	if err := os.MkdirAll(filepath.Dir(cfg.Database.Path), 0o755); err != nil {
		log.Fatalf("mkdir db dir: %v", err)
	}

	if err := database.RunMigrations(cfg.Database.Path, "internal/database/migrations"); err != nil {
		log.Fatalf("migrate: %v", err)
	}

	db, err := database.Open(cfg.Database.Path)
	if err != nil {
		log.Fatalf("open db: %v", err)
	}
	defer db.Close()

	if err := database.SeedDefaults(ctx, db); err != nil {
		log.Fatalf("seed defaults: %v", err)
	}

	// repositories
	txRepo := repository.NewTransactionRepo(db)
	acctRepo := repository.NewAccountRepo(db)
	catRepo := repository.NewCategoryRepo(db)
	ruleRepo := repository.NewMerchantRuleRepo(db)
	reconRepo := repository.NewReconciliationRepo(db)
	tagRepo := repository.NewTagRepo(db)

	// seed minimal data if empty
	seedIfEmpty(ctx, txRepo, acctRepo, catRepo, ruleRepo)

	apiKey := os.Getenv(cfg.LLM.APIKeyEnv)
	if apiKey == "" {
		apiKey = cfg.LLM.APIKey
	}

	// services (ready for wiring into TUI)
	categorizer := &service.CategorizerService{Transactions: txRepo, Rules: ruleRepo, Categories: catRepo, Provider: llm.NewGeminiProvider(apiKey, cfg.LLM.Model)}
	reconciler := &service.Reconciler{Transactions: txRepo, Pending: reconRepo, Provider: llm.NewGeminiProvider(apiKey, cfg.LLM.Model)}
	ingester := &service.IngestService{Transactions: txRepo, Accounts: acctRepo}
	maintenance := &service.MaintenanceService{DB: db}

	loc, err := time.LoadLocation(cfg.UI.Timezone)
	if err != nil {
		log.Printf("warn: using local timezone due to load failure: %v", err)
		loc = time.Local
	}

	p := tea.NewProgram(tui.New(ctx, cfg,
		tui.Repos{Transactions: txRepo, Categories: catRepo, Pending: reconRepo, Tags: tagRepo},
		tui.Services{Categorizer: categorizer, Reconciler: reconciler, Ingest: ingester, Maintenance: maintenance},
		loc,
	))
	if _, err := p.Run(); err != nil {
		fmt.Printf("error: %v\n", err)
	}
}

func seedIfEmpty(ctx context.Context, txRepo *repository.TransactionRepo, acctRepo *repository.AccountRepo, catRepo *repository.CategoryRepo, ruleRepo *repository.MerchantRuleRepo) {
	txs, err := txRepo.List(ctx, repository.TransactionFilters{})
	if err == nil && len(txs) > 0 {
		return
	}
	repos := testdata.Repos{Accounts: acctRepo, Categories: catRepo, Transactions: txRepo}
	_ = testdata.Seed(ctx, repos)
	// sample rule using first category
	cats, _ := catRepo.List(ctx)
	catID := ""
	if len(cats) > 0 {
		catID = cats[0].ID
	}
	rule := repository.MerchantRule{ID: uuid.NewString(), Pattern: "UBER EATS", PatternType: "contains", CategoryID: catID, Confidence: 0.9, Source: "user"}
	_ = ruleRepo.Add(ctx, rule)
}
