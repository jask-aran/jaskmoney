package main

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	tea "github.com/charmbracelet/bubbletea"

	"github.com/jask/jaskmoney/internal/config"
	"github.com/jask/jaskmoney/internal/database"
	"github.com/jask/jaskmoney/internal/database/repository"
	"github.com/jask/jaskmoney/internal/llm"
	"github.com/jask/jaskmoney/internal/prefs"
	"github.com/jask/jaskmoney/internal/secrets"
	"github.com/jask/jaskmoney/internal/service"
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

	// restore categories from prefs file if present
	if cats, err := prefs.LoadCategories(); err == nil && len(cats) > 0 {
		for _, c := range cats {
			_ = catRepo.Upsert(ctx, c)
		}
	}

	apiKey := resolveAPIKey(cfg)

	provider := llmProvider(cfg.LLM.Provider, apiKey, cfg.LLM.Model)

	// services (ready for wiring into TUI)
	categorizer := &service.CategorizerService{Transactions: txRepo, Rules: ruleRepo, Categories: catRepo, Provider: provider}
	reconciler := &service.Reconciler{Transactions: txRepo, Pending: reconRepo, Provider: provider}
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
	), tea.WithAltScreen())
	if _, err := p.Run(); err != nil {
		fmt.Printf("error: %v\n", err)
	}
}

func llmProvider(name, apiKey, model string) llm.LLMProvider {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "openai":
		return llm.NewOpenAIProvider(apiKey, model)
	default:
		return llm.NewGeminiProvider(apiKey, model)
	}
}

func resolveAPIKey(cfg config.Config) string {
	provider := strings.ToLower(strings.TrimSpace(cfg.LLM.Provider))
	env := strings.TrimSpace(cfg.LLM.APIKeyEnv)
	if env == "" {
		if provider == "openai" {
			env = "OPENAI_API_KEY"
		} else {
			env = "GEMINI_API_KEY"
		}
	}
	if v := os.Getenv(env); v != "" {
		return v
	}
	if k, err := secrets.FetchProviderKey(provider); err == nil {
		return k
	}
	return strings.TrimSpace(cfg.LLM.APIKey)
}
