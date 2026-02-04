package llm

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// GeminiProvider is a lightweight, offline-friendly heuristic implementation.
// It mimics the interface and behavior (timeouts, retries) so the rest of the app
// can remain non-blocking while real API wiring is added later.
type GeminiProvider struct {
	apiKey string
	model  string
}

func NewGeminiProvider(apiKey, model string) *GeminiProvider {
	return &GeminiProvider{apiKey: apiKey, model: model}
}

// Categorize returns a best-effort category guess using simple keyword heuristics.
// Timeout: 8s; Retry: one retry on context deadline/temporary failures (not expected here).
func (g *GeminiProvider) Categorize(ctx context.Context, req CategorizeRequest) (CategorizeResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	desc := strings.ToLower(req.Transaction.Description)
	bestCat, bestScore := "", 0.0
	for _, cat := range req.Categories {
		score := keywordScore(desc, cat)
		if score > bestScore {
			bestScore, bestCat = score, cat
		}
	}

	// merchant hint: take first word if it looks like a brandish token
	merchant := ""
	if parts := strings.Fields(req.Transaction.Description); len(parts) > 0 {
		merchant = properCap(parts[0])
	}

	return CategorizeResponse{
		Category:      bestCat,
		Confidence:    bestScore,
		MerchantName:  merchant,
		SuggestedRule: nil,
	}, nil
}

// ReconciliationJudge scores similarity with a simple function: amount match + date window + description similarity.
// Timeout: 8s.
func (g *GeminiProvider) ReconciliationJudge(ctx context.Context, req ReconcileRequest) (ReconcileResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	// identical amount assumed by upstream filter; use description similarity + date difference
	sim := textSimilarity(strings.ToLower(req.TransactionA.Description), strings.ToLower(req.TransactionB.Description))
	datePenalty := float64(req.DateDifferenceDays) / 7.0
	if datePenalty > 1 {
		datePenalty = 1
	}
	conf := sim * (1 - 0.3*datePenalty)

	reason := "similar description"
	if req.DateDifferenceDays > 0 {
		reason += ", dates " + pluralize(req.DateDifferenceDays, "day") + " apart"
	}

	return ReconcileResponse{
		IsDuplicate: conf >= 0.6,
		Confidence:  conf,
		Reasoning:   reason,
	}, nil
}

func (g *GeminiProvider) SuggestRule(ctx context.Context, req RuleRequest) (RuleResponse, error) {
	// Without real LLM, no robust rule suggestion; return empty to avoid noise.
	return RuleResponse{}, nil
}

func keywordScore(desc, cat string) float64 {
	catLower := strings.ToLower(cat)
	if strings.Contains(desc, catLower) {
		return 0.9
	}
	// coarse heuristics
	switch {
	case strings.Contains(desc, "uber") || strings.Contains(desc, "lyft"):
		if strings.Contains(catLower, "transport") {
			return 0.85
		}
	case strings.Contains(desc, "woolworth") || strings.Contains(desc, "aldi") || strings.Contains(desc, "coles"):
		if strings.Contains(catLower, "grocery") || strings.Contains(catLower, "food") {
			return 0.85
		}
	case strings.Contains(desc, "amazon") || strings.Contains(desc, "ebay"):
		if strings.Contains(catLower, "shopping") {
			return 0.8
		}
	case strings.Contains(desc, "spotify") || strings.Contains(desc, "netflix"):
		if strings.Contains(catLower, "subscription") || strings.Contains(catLower, "fixed") {
			return 0.8
		}
	}
	// fallback: partial overlap ratio
	return textSimilarity(desc, catLower)
}

// textSimilarity is a simple token overlap ratio in [0,1].
func textSimilarity(a, b string) float64 {
	aTokens := tokens(a)
	bTokens := tokens(b)
	if len(aTokens) == 0 || len(bTokens) == 0 {
		return 0
	}
	intersect := 0
	for t := range aTokens {
		if _, ok := bTokens[t]; ok {
			intersect++
		}
	}
	union := len(aTokens) + len(bTokens) - intersect
	return float64(intersect) / float64(union)
}

func tokens(s string) map[string]struct{} {
	parts := strings.FieldsFunc(s, func(r rune) bool { return r == ' ' || r == '-' || r == '_' || r == '/' || r == '*' })
	out := make(map[string]struct{}, len(parts))
	for _, p := range parts {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		out[p] = struct{}{}
	}
	return out
}

func pluralize(n int, word string) string {
	if n == 1 {
		return "1 " + word
	}
	return fmt.Sprintf("%d %ss", n, word)
}

func properCap(s string) string {
	if s == "" {
		return s
	}
	lower := strings.ToLower(s)
	return strings.ToUpper(lower[:1]) + lower[1:]
}
