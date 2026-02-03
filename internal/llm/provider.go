package llm

import "context"

// LLMProvider defines methods used by services.
type LLMProvider interface {
	Categorize(ctx context.Context, req CategorizeRequest) (CategorizeResponse, error)
	ReconciliationJudge(ctx context.Context, req ReconcileRequest) (ReconcileResponse, error)
	SuggestRule(ctx context.Context, req RuleRequest) (RuleResponse, error)
}

// Requests/Responses are aligned to SPEC.md.
type CategorizeRequest struct {
	Transaction             TransactionInput     `json:"transaction"`
	KnownMerchants          []string             `json:"known_merchants"`
	Categories              []string             `json:"categories"`
	SimilarPastTransactions []SimilarTransaction `json:"similar_past_transactions"`
}

type TransactionInput struct {
	Description string `json:"description"`
	Amount      int64  `json:"amount"`
	Date        string `json:"date"`
	Account     string `json:"account"`
}

type SimilarTransaction struct {
	Description string `json:"description"`
	Category    string `json:"category"`
}

type CategorizeResponse struct {
	Category      string         `json:"category"`
	MerchantName  string         `json:"merchant_name"`
	Confidence    float64        `json:"confidence"`
	SuggestedRule *SuggestedRule `json:"suggested_rule"`
}

type SuggestedRule struct {
	Pattern          string `json:"pattern"`
	PatternType      string `json:"pattern_type"`
	AppliesGenerally bool   `json:"applies_generally"`
}

type ReconcileRequest struct {
	TransactionA       TransactionInput `json:"transaction_a"`
	TransactionB       TransactionInput `json:"transaction_b"`
	DateDifferenceDays int              `json:"date_difference_days"`
}

type ReconcileResponse struct {
	IsDuplicate bool    `json:"is_duplicate"`
	Confidence  float64 `json:"confidence"`
	Reasoning   string  `json:"reasoning"`
}

type RuleRequest struct {
	Transaction TransactionInput `json:"transaction"`
}

type RuleResponse struct {
	Rule SuggestedRule `json:"rule"`
}
