package llm

import (
	"context"
)

// GeminiProvider is a placeholder stub; real implementation would call Google Generative AI.
type GeminiProvider struct{}

func NewGeminiProvider(apiKey, model string) *GeminiProvider { return &GeminiProvider{} }

func (g *GeminiProvider) Categorize(ctx context.Context, req CategorizeRequest) (CategorizeResponse, error) {
	// Placeholder: return zero-values; caller should handle low confidence.
	return CategorizeResponse{Confidence: 0}, nil
}

func (g *GeminiProvider) ReconciliationJudge(ctx context.Context, req ReconcileRequest) (ReconcileResponse, error) {
	return ReconcileResponse{IsDuplicate: false, Confidence: 0}, nil
}

func (g *GeminiProvider) SuggestRule(ctx context.Context, req RuleRequest) (RuleResponse, error) {
	return RuleResponse{}, nil
}
