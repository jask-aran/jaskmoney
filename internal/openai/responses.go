package openai

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// Minimal subset of the official Responses API used by this app.
// Fields mirror the documented wire format; unknown fields are omitted.

type Client struct {
	apiKey string
	http   *http.Client
}

func NewClient(apiKey string) *Client {
	return &Client{apiKey: apiKey, http: http.DefaultClient}
}

type ResponsesService struct{ c *Client }

func (c *Client) Responses() *ResponsesService { return &ResponsesService{c: c} }

type ResponseRequest struct {
	Model               string          `json:"model"`
	Input               []ResponseInput `json:"input"`
	MaxOutputTokens     int             `json:"max_output_tokens,omitempty"`
	Metadata            map[string]any  `json:"metadata,omitempty"`
	ResponseFormat      *ResponseFormat `json:"response_format,omitempty"`
	TruncationStrategy  *Truncation     `json:"truncation_strategy,omitempty"`
}

type Truncation struct {
	Type string `json:"type,omitempty"`
}

type ResponseFormat struct {
	Type string `json:"type"`
}

type ResponseInput struct {
	Role    string `json:"role,omitempty"`
	Content string `json:"content,omitempty"`
}

type Response struct {
	Output []string `json:"output_text"`
}

func (s *ResponsesService) CreateResponse(ctx context.Context, req ResponseRequest) (Response, error) {
	var out Response
	body, _ := json.Marshal(req)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.openai.com/v1/responses", bytes.NewReader(body))
	if err != nil {
		return out, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+s.c.apiKey)
	resp, err := s.c.http.Do(httpReq)
	if err != nil {
		return out, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		var apiErr map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&apiErr)
		return out, fmt.Errorf("openai: http %d: %v", resp.StatusCode, apiErr)
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return out, err
	}
	return out, nil
}
