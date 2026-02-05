package service

import (
	"context"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/jask/jaskmoney/internal/database/repository"
	"github.com/jask/jaskmoney/internal/llm"
)

const llmConfidenceThreshold = 0.70

// CategorizerService applies categorization precedence.
type CategorizerService struct {
	Transactions *repository.TransactionRepo
	Rules        *repository.MerchantRuleRepo
	Categories   *repository.CategoryRepo
	Provider     llm.LLMProvider
}

func (s *CategorizerService) CategorizeTransaction(ctx context.Context, tx repository.Transaction, allowOverride bool) error {
	// 1) user override already? if category set and source user we don't know; assume any set means skip
	if tx.CategoryID != nil && !allowOverride {
		return nil
	}

	// 2) merchant rules
	if mr, _ := s.Rules.Match(ctx, tx.RawDescription); mr != nil {
		return s.Transactions.UpdateCategory(ctx, tx.ID, &mr.CategoryID)
	}

	// 3) LLM
	resp, err := s.Provider.Categorize(ctx, llm.CategorizeRequest{
		Transaction: llm.TransactionInput{
			Description: tx.RawDescription,
			Amount:      tx.AmountCents,
			Date:        tx.Date.Format("2006-01-02"),
			Account:     tx.AccountID,
		},
		KnownMerchants: s.knownMerchants(ctx),
		Categories:     s.categoryNames(ctx),
	})
	if err != nil {
		return err
	}

	if resp.Confidence >= llmConfidenceThreshold {
		catID := s.findCategoryIDByName(ctx, resp.Category)
		if catID != "" {
			_ = s.Transactions.UpdateCategory(ctx, tx.ID, &catID)
		}
		if resp.MerchantName != "" {
			name := resp.MerchantName
			_ = s.Transactions.UpdateMerchant(ctx, tx.ID, &name)
		}
		if resp.SuggestedRule != nil && resp.SuggestedRule.AppliesGenerally && resp.Category != "" {
			catID := s.findCategoryIDByName(ctx, resp.Category)
			if catID != "" {
				_ = s.Rules.Add(ctx, repository.MerchantRule{
					ID:          uuid.NewString(),
					Pattern:     resp.SuggestedRule.Pattern,
					PatternType: resp.SuggestedRule.PatternType,
					CategoryID:  catID,
					Confidence:  resp.Confidence,
					Source:      "llm",
					CreatedAt:   time.Now().UTC(),
				})
			}
		}
	}
	return nil
}

func (s *CategorizerService) knownMerchants(ctx context.Context) []string {
	// simplistic: gather merchant_names we already have
	rows, err := s.Transactions.List(ctx, repository.TransactionFilters{})
	if err != nil {
		return nil
	}
	seen := map[string]struct{}{}
	var out []string
	for _, t := range rows {
		if t.MerchantName != nil {
			if _, ok := seen[*t.MerchantName]; !ok {
				seen[*t.MerchantName] = struct{}{}
				out = append(out, *t.MerchantName)
			}
		}
	}
	return out
}

func (s *CategorizerService) categoryNames(ctx context.Context) []string {
	cats, err := s.Categories.List(ctx)
	if err != nil {
		return nil
	}
	_, paths := buildCategoryPaths(cats)
	return paths
}

func (s *CategorizerService) findCategoryIDByName(ctx context.Context, name string) string {
	cats, err := s.Categories.List(ctx)
	if err != nil {
		return ""
	}
	index, _ := buildCategoryPaths(cats)
	if id, ok := index[normalizeCategoryName(name)]; ok {
		return id
	}
	clean := normalizeCategoryName(name)
	for _, c := range cats {
		if normalizeCategoryName(c.Name) == clean {
			return c.ID
		}
	}
	return ""
}

func buildCategoryPaths(cats []repository.Category) (map[string]string, []string) {
	byID := make(map[string]repository.Category, len(cats))
	for _, c := range cats {
		byID[c.ID] = c
	}
	index := make(map[string]string, len(cats))
	paths := make([]string, 0, len(cats))
	for _, c := range cats {
		path := c.Name
		if !strings.Contains(path, ">") {
			parent := c.ParentID
			for parent != nil {
				p, ok := byID[*parent]
				if !ok {
					break
				}
				path = p.Name + " > " + path
				parent = p.ParentID
			}
		}
		index[normalizeCategoryName(path)] = c.ID
		paths = append(paths, path)
	}
	return index, paths
}

func normalizeCategoryName(name string) string {
	return strings.ToLower(strings.TrimSpace(name))
}
