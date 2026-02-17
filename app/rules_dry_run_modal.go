package app

import (
	"fmt"
	"strings"

	tea "github.com/charmbracelet/bubbletea"
	"github.com/charmbracelet/x/ansi"

	"jaskmoney-v2/core"
	coredb "jaskmoney-v2/core/db"
)

type rulesDryRunModal struct {
	scopeLabel string
	results    []coredb.RuleRunOutcome
	summary    coredb.RuleRunSummary
	cursor     int
}

func newRulesDryRunModal(scopeLabel string, results []coredb.RuleRunOutcome, summary coredb.RuleRunSummary) core.Screen {
	return &rulesDryRunModal{
		scopeLabel: strings.TrimSpace(scopeLabel),
		results:    append([]coredb.RuleRunOutcome(nil), results...),
		summary:    summary,
	}
}

func (m *rulesDryRunModal) Title() string { return "Rules Dry Run" }

func (m *rulesDryRunModal) Scope() string { return "screen:rules-dry-run" }

func (m *rulesDryRunModal) Update(msg tea.Msg) (core.Screen, tea.Cmd, bool) {
	keyMsg, ok := msg.(tea.KeyMsg)
	if !ok {
		return m, nil, false
	}
	switch strings.ToLower(strings.TrimSpace(keyMsg.String())) {
	case "esc":
		return m, nil, true
	case "j", "down":
		if len(m.results) > 0 && m.cursor < len(m.results)-1 {
			m.cursor++
		}
	case "k", "up":
		if m.cursor > 0 {
			m.cursor--
		}
	}
	return m, nil, false
}

func (m *rulesDryRunModal) View(width, height int) string {
	lines := []string{
		"Rules Dry Run",
		"Scope: " + fallbackLabel(m.scopeLabel, "all accounts"),
		fmt.Sprintf(
			"Summary: %d modified, %d category changes, %d tag changes, %d failed rules",
			m.summary.TotalModified,
			m.summary.TotalCategoryChanges,
			m.summary.TotalTagChanges,
			m.summary.FailedRules,
		),
		"",
	}

	if len(m.results) == 0 {
		lines = append(lines, "No enabled rules to evaluate.")
	} else {
		start := m.cursor
		if start < 0 {
			start = 0
		}
		if start >= len(m.results) {
			start = len(m.results) - 1
		}
		maxRows := 2
		if height > 18 {
			maxRows = 3
		}
		end := start + maxRows
		if end > len(m.results) {
			end = len(m.results)
		}
		for i := start; i < end; i++ {
			row := m.results[i]
			lines = append(lines, fmt.Sprintf("Rule %d: %s", i+1, strings.TrimSpace(row.RuleName)))
			if row.Error != "" {
				lines = append(lines, "  Error: "+row.Error)
				lines = append(lines, "")
				continue
			}
			filterLabel := strings.TrimSpace(row.FilterExpr)
			if filterLabel == "" {
				filterLabel = strings.TrimSpace(row.FilterID)
			}
			lines = append(lines, "  Filter: "+filterLabel)
			lines = append(lines, fmt.Sprintf("  Matches: %d", row.Matched))
			lines = append(lines, fmt.Sprintf("  Changes: %d category, %d tags", row.CategoryChanges, row.TagChanges))
			for _, sample := range row.Samples {
				lines = append(lines, fmt.Sprintf(
					"    %s  %s  %s",
					sample.DateISO,
					formatMoney(sample.Amount),
					ansi.Truncate(strings.TrimSpace(sample.Description), 30, ""),
				))
			}
			lines = append(lines, "")
		}
	}
	lines = append(lines, "j/k scroll  esc close")
	return core.ClipHeight(strings.Join(lines, "\n"), core.MaxInt(6, height))
}

func fallbackLabel(v, fallback string) string {
	v = strings.TrimSpace(v)
	if v == "" {
		return fallback
	}
	return v
}
