package llm

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
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

var ErrNoAPIKey = errors.New("gemini: api key not configured")
var errModelNotFound = errors.New("gemini: model not found")

func (g *GeminiProvider) SetAPIKey(key string) {
	g.apiKey = strings.TrimSpace(key)
	// reset model to allow discovery on next request
	if g.apiKey != "" {
		g.model = strings.TrimSpace(g.model)
	}
}

func (g *GeminiProvider) SetModel(model string) {
	g.model = strings.TrimSpace(model)
}

// Categorize returns a best-effort category guess using simple keyword heuristics.
// Timeout: 8s; Retry: one retry on context deadline/temporary failures (not expected here).
func (g *GeminiProvider) Categorize(ctx context.Context, req CategorizeRequest) (CategorizeResponse, error) {
	if strings.TrimSpace(g.apiKey) == "" {
		return CategorizeResponse{}, ErrNoAPIKey
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ { // retry once on transient failure
		resp, err := g.categorizeLLM(ctx, req)
		if err == nil {
			return resp, nil
		}
		lastErr = err
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			break
		}
	}
	return CategorizeResponse{}, lastErr
}

func (g *GeminiProvider) categorizeLLM(ctx context.Context, req CategorizeRequest) (CategorizeResponse, error) {
	payload, err := json.Marshal(req)
	if err != nil {
		return CategorizeResponse{}, fmt.Errorf("gemini: encode request: %w", err)
	}
	prompt := "Input JSON:\n" + string(payload)
	system := "You are a finance categorization assistant. Return ONLY valid JSON with keys: category (string), merchant_name (string), confidence (number 0-1), suggested_rule (object or null). suggested_rule has keys: pattern, pattern_type, applies_generally."
	text, err := g.generateJSON(ctx, prompt, system)
	if err != nil {
		return CategorizeResponse{}, err
	}
	var resp CategorizeResponse
	if err := decodeJSON(text, &resp); err != nil {
		return CategorizeResponse{}, fmt.Errorf("gemini: parse categorize: %w", err)
	}
	resp.Confidence = clamp01(resp.Confidence)
	return resp, nil
}

// ReconciliationJudge scores similarity with a simple function: amount match + date window + description similarity.
// Timeout: 8s.
func (g *GeminiProvider) ReconciliationJudge(ctx context.Context, req ReconcileRequest) (ReconcileResponse, error) {
	if strings.TrimSpace(g.apiKey) == "" {
		return ReconcileResponse{}, ErrNoAPIKey
	}
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()

	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		resp, err := g.reconcileLLM(ctx, req)
		if err == nil {
			return resp, nil
		}
		lastErr = err
		if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			break
		}
	}
	return ReconcileResponse{}, lastErr
}

func (g *GeminiProvider) reconcileLLM(ctx context.Context, req ReconcileRequest) (ReconcileResponse, error) {
	payload, err := json.Marshal(req)
	if err != nil {
		return ReconcileResponse{}, fmt.Errorf("gemini: encode request: %w", err)
	}
	prompt := "Input JSON:\n" + string(payload)
	system := "You are a finance reconciliation assistant. Return ONLY valid JSON with keys: is_duplicate (boolean), confidence (number 0-1), reasoning (string)."
	text, err := g.generateJSON(ctx, prompt, system)
	if err != nil {
		return ReconcileResponse{}, err
	}
	var resp ReconcileResponse
	if err := decodeJSON(text, &resp); err != nil {
		return ReconcileResponse{}, fmt.Errorf("gemini: parse reconcile: %w", err)
	}
	resp.Confidence = clamp01(resp.Confidence)
	return resp, nil
}

func (g *GeminiProvider) SuggestRule(ctx context.Context, req RuleRequest) (RuleResponse, error) {
	// Without real LLM, no robust rule suggestion; return empty to avoid noise.
	return RuleResponse{}, nil
}

type geminiRequest struct {
	Contents          []geminiContent         `json:"contents"`
	SystemInstruction *geminiContent          `json:"systemInstruction,omitempty"`
	GenerationConfig  *geminiGenerationConfig `json:"generationConfig,omitempty"`
}

type geminiContent struct {
	Role  string       `json:"role,omitempty"`
	Parts []geminiPart `json:"parts"`
}

type geminiPart struct {
	Text string `json:"text"`
}

type geminiGenerationConfig struct {
	Temperature      float64 `json:"temperature,omitempty"`
	MaxOutputTokens  int     `json:"maxOutputTokens,omitempty"`
	ResponseMIMEType string  `json:"responseMimeType,omitempty"`
}

type geminiResponse struct {
	Candidates     []geminiCandidate `json:"candidates"`
	PromptFeedback *promptFeedback   `json:"promptFeedback,omitempty"`
}

type geminiCandidate struct {
	Content geminiContent `json:"content"`
}

type promptFeedback struct {
	BlockReason string `json:"blockReason"`
}

type geminiError struct {
	Error struct {
		Message string `json:"message"`
	} `json:"error"`
}

func (g *GeminiProvider) generateJSON(ctx context.Context, prompt, system string) (string, error) {
	if strings.TrimSpace(g.apiKey) == "" {
		return "", ErrNoAPIKey
	}
	model := g.resolveModel()
	endpoint := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/%s:generateContent?key=%s", model, url.QueryEscape(g.apiKey))
	reqBody := geminiRequest{
		Contents: []geminiContent{{
			Role:  "user",
			Parts: []geminiPart{{Text: prompt}},
		}},
		SystemInstruction: &geminiContent{Parts: []geminiPart{{Text: system}}},
		GenerationConfig: &geminiGenerationConfig{
			Temperature:      0.2,
			MaxOutputTokens:  512,
			ResponseMIMEType: "application/json",
		},
	}
	encoded, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("gemini: encode request: %w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(encoded))
	if err != nil {
		return "", fmt.Errorf("gemini: build request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(request)
	if err != nil {
		return "", fmt.Errorf("gemini: request: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("gemini: read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var apiErr geminiError
		if err := json.Unmarshal(body, &apiErr); err == nil && apiErr.Error.Message != "" {
			msg := apiErr.Error.Message
			if isModelNotFound(msg) {
				if alt := g.discoverModel(ctx); alt != "" {
					g.model = alt
					return g.generateJSON(ctx, prompt, system)
				}
				return "", errModelNotFound
			}
			return "", fmt.Errorf("gemini: %s", msg)
		}
		if resp.StatusCode == http.StatusNotFound {
			if alt := g.discoverModel(ctx); alt != "" {
				g.model = alt
				return g.generateJSON(ctx, prompt, system)
			}
			return "", errModelNotFound
		}
		return "", fmt.Errorf("gemini: http %d", resp.StatusCode)
	}
	var parsed geminiResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("gemini: decode response: %w", err)
	}
	if parsed.PromptFeedback != nil && parsed.PromptFeedback.BlockReason != "" {
		return "", fmt.Errorf("gemini: blocked: %s", parsed.PromptFeedback.BlockReason)
	}
	if len(parsed.Candidates) == 0 {
		return "", fmt.Errorf("gemini: empty response")
	}
	return strings.TrimSpace(contentText(parsed.Candidates[0].Content)), nil
}

func contentText(content geminiContent) string {
	var b strings.Builder
	for _, part := range content.Parts {
		b.WriteString(part.Text)
	}
	return b.String()
}

func decodeJSON(raw string, out any) error {
	text := strings.TrimSpace(raw)
	text = strings.TrimPrefix(text, "```json")
	text = strings.TrimPrefix(text, "```")
	text = strings.TrimSuffix(text, "```")
	text = strings.TrimSpace(text)
	if !strings.HasPrefix(text, "{") {
		start := strings.Index(text, "{")
		end := strings.LastIndex(text, "}")
		if start >= 0 && end > start {
			text = text[start : end+1]
		}
	}
	if err := json.Unmarshal([]byte(text), out); err != nil {
		return err
	}
	return nil
}

func clamp01(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}

func (g *GeminiProvider) resolveModel() string {
	model := strings.TrimSpace(g.model)
	if model == "" {
		model = "gemini-3-flash-preview"
	}
	if !strings.HasPrefix(model, "models/") {
		model = "models/" + model
	}
	return model
}

type geminiModelsResponse struct {
	Models []struct {
		Name string `json:"name"`
	} `json:"models"`
}

func (g *GeminiProvider) ListModels(ctx context.Context) ([]string, error) {
	if strings.TrimSpace(g.apiKey) == "" {
		return nil, ErrNoAPIKey
	}
	endpoint := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models?key=%s", url.QueryEscape(g.apiKey))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("gemini: build request: %w", err)
	}
	resp, err := http.DefaultClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("gemini: request: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("gemini: http %d", resp.StatusCode)
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("gemini: read response: %w", err)
	}
	var parsed geminiModelsResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return nil, fmt.Errorf("gemini: decode response: %w", err)
	}
	models := make([]string, 0, len(parsed.Models))
	for _, m := range parsed.Models {
		models = append(models, m.Name)
	}
	return models, nil
}

func (g *GeminiProvider) discoverModel(ctx context.Context) string {
	if strings.TrimSpace(g.apiKey) == "" {
		return ""
	}
	endpoint := fmt.Sprintf("https://generativelanguage.googleapis.com/v1beta/models?key=%s", url.QueryEscape(g.apiKey))
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return ""
	}
	resp, err := http.DefaultClient.Do(request)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return ""
	}
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return ""
	}
	var parsed geminiModelsResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return ""
	}
	preferred := []string{
		"models/gemini-3-flash-preview",
		"models/gemini-3-flash",
		"models/gemini-2.5-flash-latest",
		"models/gemini-2.5-flash",
		"models/gemini-2.0-flash",
		"models/gemini-1.5-flash",
	}
	available := map[string]struct{}{}
	for _, m := range parsed.Models {
		available[m.Name] = struct{}{}
	}
	for _, candidate := range preferred {
		if _, ok := available[candidate]; ok {
			return candidate
		}
	}
	if len(parsed.Models) > 0 {
		return parsed.Models[0].Name
	}
	return ""
}

func isModelNotFound(msg string) bool {
	lower := strings.ToLower(msg)
	return strings.Contains(lower, "model") && strings.Contains(lower, "not found")
}
