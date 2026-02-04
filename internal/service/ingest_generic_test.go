package service

import (
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/jask/jaskmoney/internal/database"
	"github.com/jask/jaskmoney/internal/database/repository"
)

func setupIngestTest(t *testing.T) (*IngestService, *repository.TransactionRepo, *repository.AccountRepo, context.Context) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	t.Cleanup(cancel)

	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")
	migrations, err := filepath.Abs("../database/migrations")
	require.NoError(t, err)
	require.NoError(t, database.RunMigrations(dbPath, migrations))

	db, err := database.Open(dbPath)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	txRepo := repository.NewTransactionRepo(db)
	acctRepo := repository.NewAccountRepo(db)
	return &IngestService{Transactions: txRepo, Accounts: acctRepo}, txRepo, acctRepo, ctx
}

func TestImportCSV_HappyPath(t *testing.T) {
	t.Parallel()
	svc, txRepo, acctRepo, ctx := setupIngestTest(t)

	data := "2026-02-01,2026-02-02,WOOLWORTHS 123,-45.67,ext-1,Everyday\n" +
		"2026-02-03,,SALARY,+2500.00,,Salary"

	res, err := svc.ImportCSV(ctx, strings.NewReader(data), time.UTC)
	require.NoError(t, err)
	require.Empty(t, res.Errors)
	require.Equal(t, 2, res.Imported)
	require.Equal(t, 0, res.Skipped)

	txs, err := txRepo.List(ctx, repository.TransactionFilters{})
	require.NoError(t, err)
	require.Len(t, txs, 2)

	accts, err := acctRepo.List(ctx)
	require.NoError(t, err)
	require.Len(t, accts, 2)
}

func TestImportCSV_ErrorsAndSkips(t *testing.T) {
	t.Parallel()
	svc, txRepo, _, ctx := setupIngestTest(t)

	bad := "2026-02-01,2026-02-02,WOOLWORTHS 123,-45.67,ext-1,Everyday\n" + // ok
		"not-a-date,2026-02-02,BAD,10.00,,Everyday\n" + // bad date
		"2026-02-05,2026-02-06,WOOLWORTHS 123,-45.67,ext-1,Everyday" // duplicate external

	res, err := svc.ImportCSV(ctx, strings.NewReader(bad), time.UTC)
	require.NoError(t, err)
	require.Equal(t, 1, res.Imported)
	require.Equal(t, 1, res.Skipped) // duplicate
	require.Len(t, res.Errors, 1)    // bad date

	txs, err := txRepo.List(ctx, repository.TransactionFilters{})
	require.NoError(t, err)
	require.Len(t, txs, 1)
}
