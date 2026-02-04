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

func TestImportANZSimple(t *testing.T) {
	t.Parallel()

	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "test.db")
	migrations, err := filepath.Abs("../database/migrations")
	require.NoError(t, err)
	require.NoError(t, database.RunMigrations(dbPath, migrations))
	t.Log("migrations applied")

	db, err := database.Open(dbPath)
	require.NoError(t, err)
	t.Cleanup(func() { _ = db.Close() })

	txRepo := repository.NewTransactionRepo(db)
	acctRepo := repository.NewAccountRepo(db)
	svc := &IngestService{Transactions: txRepo, Accounts: acctRepo}

	var one int
	require.NoError(t, db.QueryRowContext(ctx, "SELECT 1").Scan(&one))
	require.Equal(t, 1, one)
	t.Log("db responsive")

	loc, err := time.LoadLocation("Australia/Melbourne")
	require.NoError(t, err)

	data := strings.Join([]string{
		"3/02/2026,203.92,PAYMENT THANKYOU 528417",
		"2/02/2026,-20,DAN MURPHY'S/580 MELBOURN SPOTSWOOD",
	}, "\n")

	res, err := svc.ImportANZSimple(ctx, strings.NewReader(data), "ANZ Credit", loc)
	require.NoError(t, err)
	require.Empty(t, res.Errors)
	require.Equal(t, 2, res.Imported)
	require.Equal(t, 0, res.Skipped)
	t.Log("import complete")

	var count int
	require.NoError(t, db.QueryRowContext(ctx, "SELECT COUNT(*) FROM transactions").Scan(&count))
	require.Equal(t, 2, count)
	t.Log("count query ok")

	t.Log("listing transactions")
	txs, err := txRepo.List(ctx, repository.TransactionFilters{})
	require.NoError(t, err)
	require.Len(t, txs, 2)
	require.Equal(t, txs[0].AccountID, txs[1].AccountID)
	expected := map[string]struct {
		amount int64
		date   string
	}{
		"PAYMENT THANKYOU 528417":             {amount: 20392, date: "2026-02-03"},
		"DAN MURPHY'S/580 MELBOURN SPOTSWOOD": {amount: -2000, date: "2026-02-02"},
	}
	for _, tx := range txs {
		exp, ok := expected[tx.RawDescription]
		require.True(t, ok, "unexpected description %s", tx.RawDescription)
		require.Equal(t, exp.amount, tx.AmountCents)
		require.Equal(t, "posted", tx.Status)
		require.Nil(t, tx.ExternalID)
		require.NotNil(t, tx.SourceHash)
		require.NotEmpty(t, tx.AccountID)
		require.Equal(t, exp.date, tx.Date.In(loc).Format("2006-01-02"))
	}
	t.Log("first pass assertions done")

	// Re-import should skip duplicates via source hash.
	res2, err := svc.ImportANZSimple(ctx, strings.NewReader(data), "ANZ Credit", loc)
	require.NoError(t, err)
	require.Equal(t, 0, res2.Imported)
	require.Equal(t, 2, res2.Skipped)
	require.Len(t, res2.Errors, 0)
	t.Log("re-import checked")

	accts, err := acctRepo.List(ctx)
	require.NoError(t, err)
	require.Len(t, accts, 1)
	require.Equal(t, "ANZ Credit", accts[0].Name)
	t.Log("accounts verified")
}
