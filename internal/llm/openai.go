package llm

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	openai "github.com/openai/openai-go"
)

// OpenAIProvider uses the official openai-go helper (Responses API).
type OpenAIProvider struct {
	apiKey string
	model  string
	client *openai.Client
}

func NewOpenAIProvider(apiKey, model string) *OpenAIProvider {
	return &OpenAIProvider{apiKey: strings.TrimSpace(apiKey), model: strings.TrimSpace(model)}
}

var ErrOpenAINoAPIKey = fmt.Errorf("openai: api key not configured")

func (p *OpenAIProvider) ensureClient() error {
	if strings.TrimSpace(p.apiKey) == "" {
		return ErrOpenAINoAPIKey
	}
	if p.client == nil {
		p.client = openai.NewClient(p.apiKey)
	}
	return nil
}

func (p *OpenAIProvider) SetAPIKey(key string) {
	p.apiKey = strings.TrimSpace(key)
	p.client = nil
}

func (p *OpenAIProvider) SetModel(model string) {
	p.model = strings.TrimSpace(model)
}

func (p *OpenAIProvider) Categorize(ctx context.Context, req CategorizeRequest) (CategorizeResponse, error) {
	if err := p.ensureClient(); err != nil {
		return CategorizeResponse{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	payload, _ := json.Marshal(req)
	system := "You are a finance categorization assistant. Return ONLY valid JSON with keys: category (string), merchant_name (string), confidence (number 0-1), suggested_rule (object or null). suggested_rule has keys: pattern, pattern_type, applies_generally."
	respText, err := p.callResponse(ctx, system, "Input JSON:\n"+string(payload))
	if err != nil {
		return CategorizeResponse{}, err
	}
	var out CategorizeResponse
	if err := decodeJSON(respText, &out); err != nil {
		return CategorizeResponse{}, fmt.Errorf("openai: parse categorize: %w", err)
	}
	out.Confidence = clamp01(out.Confidence)
	return out, nil
}

func (p *OpenAIProvider) ReconciliationJudge(ctx context.Context, req ReconcileRequest) (ReconcileResponse, error) {
	if err := p.ensureClient(); err != nil {
		return ReconcileResponse{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	payload, _ := json.Marshal(req)
	system := "You are a finance reconciliation assistant. Return ONLY valid JSON with keys: is_duplicate (boolean), confidence (number 0-1), reasoning (string)."
	respText, err := p.callResponse(ctx, system, "Input JSON:\n"+string(payload))
	if err != nil {
		return ReconcileResponse{}, err
	}
	var out ReconcileResponse
	if err := decodeJSON(respText, &out); err != nil {
		return ReconcileResponse{}, fmt.Errorf("openai: parse reconcile: %w", err)
	}
	out.Confidence = clamp01(out.Confidence)
	return out, nil
}

func (p *OpenAIProvider) SuggestRule(ctx context.Context, req RuleRequest) (RuleResponse, error) {
	if err := p.ensureClient(); err != nil {
		return RuleResponse{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	payload, _ := json.Marshal(req)
	system := "You are a finance rule assistant. Return ONLY valid JSON with keys: rule (object with pattern, pattern_type, applies_generally)."
	respText, err := p.callResponse(ctx, system, "Input JSON:\n"+string(payload))
	if err != nil {
		return RuleResponse{}, err
	}
	var out RuleResponse
	if err := decodeJSON(respText, &out); err != nil {
		return RuleResponse{}, fmt.Errorf("openai: parse rule: %w", err)
	}
	return out, nil
}

func (p *OpenAIProvider) ListModels(ctx context.Context) ([]string, error) {
	if err := p.ensureClient(); err != nil {
		return nil, err
	}
	// Static shortlist until SDK model listing is available offline.
	return []string{
		"gpt-5-nano",
		"gpt-5-mini",
		"gpt-5",
		"gpt-5-chat-latest",
		"gpt-4o-mini",
		"gpt-4o",
		"o1-mini",
		"o1-preview",
	}, nil
}

func (p *OpenAIProvider) callResponse(ctx context.Context, system, user string) (string, error) {
	model := p.model
	if model == "" {
		model = "gpt-4o-mini"
	}
	req := openai.ResponseRequest{
		Model:           model,
		MaxOutputTokens: 400,
		Input: []openai.ResponseInput{
			{Role: "system", Content: system},
			{Role: "user", Content: user},
		},
	}
	resp, err := p.client.Responses().CreateResponse(ctx, req)
	if err != nil {
		return "", err
	}
	if len(resp.Output) == 0 {
		return "", fmt.Errorf("openai: empty response")
	}
	return strings.TrimSpace(resp.Output[0]), nil
}
