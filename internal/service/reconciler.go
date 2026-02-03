package service

import (
	"context"
	"math"
	"strings"
	"time"

	"github.com/agnivade/levenshtein"
	"github.com/google/uuid"

	"github.com/jask/jaskmoney/internal/database/repository"
	"github.com/jask/jaskmoney/internal/llm"
)

// Reconciler implements duplicate detection.
type Reconciler struct {
	Transactions *repository.TransactionRepo
	Pending      *repository.ReconciliationRepo
	Provider     llm.LLMProvider
}

// DetectAndQueue runs the 3-stage algorithm.
func (r *Reconciler) DetectAndQueue(ctx context.Context) error {
	txs, err := r.Transactions.PendingCandidates(ctx)
	if err != nil {
		return err
	}
	for i := 0; i < len(txs); i++ {
		for j := i + 1; j < len(txs); j++ {
			a, b := txs[i], txs[j]
			// Stage1 exact
			if matchExact(a, b) {
				if err := r.merge(ctx, a, b); err != nil {
					return err
				}
				continue
			}
			// Stage2 fuzzy
			if !matchFuzzyCandidate(a, b) {
				continue
			}

			// Stage3 LLM judge
			resp, err := r.Provider.ReconciliationJudge(ctx, llm.ReconcileRequest{
				TransactionA:       txToLLM(a),
				TransactionB:       txToLLM(b),
				DateDifferenceDays: int(math.Abs(a.Date.Sub(b.Date).Hours()) / 24),
			})
			if err != nil {
				continue
			}
			// queue for user review regardless of judgment, but keep confidence
			pr := repository.PendingReconciliation{
				ID:             uuid.NewString(),
				TransactionAID: a.ID,
				TransactionBID: b.ID,
				Similarity:     similarity(a, b),
				Status:         "pending",
				CreatedAt:      time.Now().UTC(),
			}
			if resp.Confidence > 0 {
				pr.LLMConfidence = &resp.Confidence
			}
			if resp.Reasoning != "" {
				reason := resp.Reasoning
				pr.LLMReasoning = &reason
			}
			if err := r.Pending.Add(ctx, pr); err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *Reconciler) merge(ctx context.Context, a, b repository.Transaction) error {
	keep, drop := chooseKeep(a, b)
	// carry metadata
	if keep.CategoryID == nil && drop.CategoryID != nil {
		_ = r.Transactions.UpdateCategory(ctx, keep.ID, drop.CategoryID)
	}
	if (keep.MerchantName == nil || *keep.MerchantName == "") && drop.MerchantName != nil {
		_ = r.Transactions.UpdateMerchant(ctx, keep.ID, drop.MerchantName)
	}
	// mark drop as reconciled
	return r.Transactions.UpdateStatus(ctx, drop.ID, "reconciled")
}

// Decide updates a pending reconciliation entry after user action.
func (r *Reconciler) Decide(ctx context.Context, pendingID string, isDuplicate bool) error {
	pr, err := r.Pending.Get(ctx, pendingID)
	if err != nil || pr == nil {
		return err
	}
	a, err := r.Transactions.Get(ctx, pr.TransactionAID)
	if err != nil || a == nil {
		return err
	}
	b, err := r.Transactions.Get(ctx, pr.TransactionBID)
	if err != nil || b == nil {
		return err
	}
	if isDuplicate {
		if err := r.merge(ctx, *a, *b); err != nil {
			return err
		}
		return r.Pending.UpdateStatus(ctx, pendingID, "merged")
	}
	return r.Pending.UpdateStatus(ctx, pendingID, "dismissed")
}

func matchExact(a, b repository.Transaction) bool {
	if a.ExternalID != nil && b.ExternalID != nil && *a.ExternalID == *b.ExternalID {
		return true
	}
	if a.SourceHash != nil && b.SourceHash != nil && *a.SourceHash == *b.SourceHash {
		return true
	}
	return false
}

func matchFuzzyCandidate(a, b repository.Transaction) bool {
	if a.AmountCents != b.AmountCents {
		return false
	}
	if daysApart(a.Date, b.Date) > 7 {
		return false
	}
	dist := levenshtein.ComputeDistance(stringsUpper(a.RawDescription), stringsUpper(b.RawDescription))
	maxlen := float64(len(a.RawDescription))
	if len(b.RawDescription) > len(a.RawDescription) {
		maxlen = float64(len(b.RawDescription))
	}
	return float64(dist)/maxlen < 0.4
}

func stringsUpper(s string) string { return strings.ToUpper(s) }

func daysApart(a, b time.Time) int {
	d := a.Sub(b)
	if d < 0 {
		d = -d
	}
	return int(d.Hours() / 24)
}

func similarity(a, b repository.Transaction) float64 {
	if a.AmountCents != b.AmountCents {
		return 0
	}
	return 1 - float64(levenshtein.ComputeDistance(a.RawDescription, b.RawDescription))/float64(max(len(a.RawDescription), len(b.RawDescription)))
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func chooseKeep(a, b repository.Transaction) (keep, drop repository.Transaction) {
	// keep later posted if available
	if a.PostedDate != nil && b.PostedDate != nil {
		if b.PostedDate.After(*a.PostedDate) {
			return b, a
		}
		return a, b
	}
	if a.Status == "posted" && b.Status != "posted" {
		return a, b
	}
	if b.Status == "posted" && a.Status != "posted" {
		return b, a
	}
	if a.Date.After(b.Date) {
		return a, b
	}
	return b, a
}

func txToLLM(t repository.Transaction) llm.TransactionInput {
	return llm.TransactionInput{
		Description: t.RawDescription,
		Amount:      t.AmountCents,
		Date:        t.Date.Format("2006-01-02"),
		Account:     t.AccountID,
	}
}
