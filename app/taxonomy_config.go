package app

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"unicode"

	"github.com/BurntSushi/toml"
)

const mandatoryIgnoreTagName = "IGNORE"

type taxonomyConfig struct {
	AppJumpKey string
	Categories []taxonomyCategory
	Tags       []taxonomyTag
}

type taxonomyCategory struct {
	Key       string
	Name      string
	Color     string
	SortOrder int
	IsDefault bool
}

type taxonomyTag struct {
	Key           string
	Name          string
	Color         string
	SortOrder     int
	ScopeCategory string
}

type rawTaxonomyConfig struct {
	Version  int                            `toml:"version"`
	App      rawTaxonomyApp                 `toml:"app"`
	Category map[string]rawTaxonomyCategory `toml:"category"`
	Tag      map[string]rawTaxonomyTag      `toml:"tag"`
}

type rawTaxonomyApp struct {
	JumpKey string `toml:"jump_key"`
}

type rawTaxonomyCategory struct {
	Name      string `toml:"name"`
	Color     string `toml:"color"`
	SortOrder int    `toml:"sort_order"`
	IsDefault bool   `toml:"is_default"`
}

type rawTaxonomyTag struct {
	Name          string `toml:"name"`
	Color         string `toml:"color"`
	SortOrder     int    `toml:"sort_order"`
	ScopeCategory string `toml:"scope_category"`
}

var defaultTaxonomyCategories = []taxonomyCategory{
	{Key: "income", Name: "Income", Color: "#a6e3a1", SortOrder: 1, IsDefault: false},
	{Key: "groceries", Name: "Groceries", Color: "#94e2d5", SortOrder: 2, IsDefault: false},
	{Key: "dining_drinks", Name: "Dining & Drinks", Color: "#fab387", SortOrder: 3, IsDefault: false},
	{Key: "transport", Name: "Transport", Color: "#89b4fa", SortOrder: 4, IsDefault: false},
	{Key: "bills_utilities", Name: "Bills & Utilities", Color: "#cba6f7", SortOrder: 5, IsDefault: false},
	{Key: "entertainment", Name: "Entertainment", Color: "#f5c2e7", SortOrder: 6, IsDefault: false},
	{Key: "shopping", Name: "Shopping", Color: "#f2cdcd", SortOrder: 7, IsDefault: false},
	{Key: "health", Name: "Health", Color: "#74c7ec", SortOrder: 8, IsDefault: false},
	{Key: "transfers", Name: "Transfers", Color: "#b4befe", SortOrder: 9, IsDefault: false},
	{Key: "uncategorised", Name: "Uncategorised", Color: "#7f849c", SortOrder: 10, IsDefault: true},
}

var defaultTaxonomyTags = []taxonomyTag{
	{Key: "ignore", Name: mandatoryIgnoreTagName, Color: "#f38ba8", SortOrder: 1, ScopeCategory: ""},
}

func EnsureTaxonomyConfig(rootDir string) error {
	_, err := loadTaxonomyConfig(rootDir)
	return err
}

func loadTaxonomyConfig(rootDir string) (taxonomyConfig, error) {
	if strings.TrimSpace(rootDir) == "" {
		rootDir = "."
	}
	path := filepath.Join(rootDir, "config", "config.toml")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return taxonomyConfig{}, fmt.Errorf("create config dir: %w", err)
	}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		cfg := taxonomyConfig{
			AppJumpKey: "v",
			Categories: cloneDefaultCategories(),
			Tags:       cloneDefaultTags(),
		}
		if err := saveTaxonomyConfig(rootDir, cfg); err != nil {
			return taxonomyConfig{}, err
		}
		return cfg, nil
	}

	var raw rawTaxonomyConfig
	if _, err := toml.DecodeFile(path, &raw); err != nil {
		return taxonomyConfig{}, fmt.Errorf("parse %s: %w", path, err)
	}
	cfg, changed := normalizeTaxonomyConfig(raw)
	if changed {
		if err := saveTaxonomyConfig(rootDir, cfg); err != nil {
			return taxonomyConfig{}, err
		}
	}
	return cfg, nil
}

func saveTaxonomyConfig(rootDir string, cfg taxonomyConfig) error {
	if strings.TrimSpace(rootDir) == "" {
		rootDir = "."
	}
	path := filepath.Join(rootDir, "config", "config.toml")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	content := renderTaxonomyConfig(cfg)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

func normalizeTaxonomyConfig(raw rawTaxonomyConfig) (taxonomyConfig, bool) {
	changed := false
	cfg := taxonomyConfig{}
	cfg.AppJumpKey = strings.ToLower(strings.TrimSpace(raw.App.JumpKey))
	if cfg.AppJumpKey == "" {
		cfg.AppJumpKey = "v"
		changed = true
	}

	cats := make([]taxonomyCategory, 0, len(raw.Category))
	nextCatOrder := 1
	for key, item := range raw.Category {
		k := strings.TrimSpace(key)
		if k == "" {
			changed = true
			continue
		}
		name := strings.TrimSpace(item.Name)
		if name == "" {
			name = k
			changed = true
		}
		color := strings.TrimSpace(item.Color)
		if color == "" {
			color = "#7f849c"
			changed = true
		}
		order := item.SortOrder
		if order <= 0 {
			order = nextCatOrder
			changed = true
		}
		nextCatOrder++
		cats = append(cats, taxonomyCategory{
			Key:       k,
			Name:      name,
			Color:     color,
			SortOrder: order,
			IsDefault: item.IsDefault,
		})
	}
	if len(cats) == 0 {
		cats = cloneDefaultCategories()
		changed = true
	}
	sortCategories(cats)

	defaultIdx := -1
	for i := range cats {
		if !cats[i].IsDefault {
			continue
		}
		if defaultIdx == -1 {
			defaultIdx = i
			continue
		}
		cats[i].IsDefault = false
		changed = true
	}
	if defaultIdx == -1 {
		for i := range cats {
			if strings.EqualFold(strings.TrimSpace(cats[i].Name), "Uncategorised") {
				cats[i].IsDefault = true
				defaultIdx = i
				changed = true
				break
			}
		}
	}
	if defaultIdx == -1 {
		cats = append(cats, taxonomyCategory{
			Key:       uniqueKeyFromName("uncategorised", categoryKeySet(cats), "category"),
			Name:      "Uncategorised",
			Color:     "#7f849c",
			SortOrder: nextCategorySortOrder(cats),
			IsDefault: true,
		})
		changed = true
		sortCategories(cats)
	}

	tags := make([]taxonomyTag, 0, len(raw.Tag))
	nextTagOrder := 1
	for key, item := range raw.Tag {
		k := strings.TrimSpace(key)
		if k == "" {
			changed = true
			continue
		}
		name := strings.TrimSpace(item.Name)
		if name == "" {
			name = k
			changed = true
		}
		color := strings.TrimSpace(item.Color)
		if color == "" {
			color = "#94e2d5"
			changed = true
		}
		order := item.SortOrder
		if order <= 0 {
			order = nextTagOrder
			changed = true
		}
		nextTagOrder++
		tags = append(tags, taxonomyTag{
			Key:           k,
			Name:          name,
			Color:         color,
			SortOrder:     order,
			ScopeCategory: strings.TrimSpace(item.ScopeCategory),
		})
	}
	if len(tags) == 0 {
		tags = cloneDefaultTags()
		changed = true
	}
	if !hasMandatoryIgnoreTag(tags) {
		tags = append(tags, taxonomyTag{
			Key:           uniqueKeyFromName("ignore", tagKeySet(tags), "tag"),
			Name:          mandatoryIgnoreTagName,
			Color:         "#f38ba8",
			SortOrder:     nextTagSortOrder(tags),
			ScopeCategory: "",
		})
		changed = true
	}

	categoryKeys := categoryKeySet(cats)
	for i := range tags {
		scope := strings.TrimSpace(tags[i].ScopeCategory)
		if scope == "" {
			continue
		}
		if categoryKeys[scope] {
			continue
		}
		tags[i].ScopeCategory = ""
		changed = true
	}
	sortTags(tags)

	cfg.Categories = cats
	cfg.Tags = tags
	return cfg, changed
}

func renderTaxonomyConfig(cfg taxonomyConfig) string {
	categories := append([]taxonomyCategory(nil), cfg.Categories...)
	tags := append([]taxonomyTag(nil), cfg.Tags...)
	sortCategories(categories)
	sortTags(tags)

	appJumpKey := strings.ToLower(strings.TrimSpace(cfg.AppJumpKey))
	if appJumpKey == "" {
		appJumpKey = "v"
	}

	var b bytes.Buffer
	b.WriteString("version = 1\n\n")
	b.WriteString("[app]\n")
	b.WriteString("jump_key = " + fmt.Sprintf("%q", appJumpKey) + "\n\n")

	b.WriteString("[category]\n")
	for _, cat := range categories {
		b.WriteString("  [category." + tomlTableKey(cat.Key) + "]\n")
		b.WriteString("    name = " + fmt.Sprintf("%q", cat.Name) + "\n")
		b.WriteString("    color = " + fmt.Sprintf("%q", cat.Color) + "\n")
		b.WriteString("    sort_order = " + fmt.Sprintf("%d", cat.SortOrder) + "\n")
		b.WriteString("    is_default = " + fmt.Sprintf("%t", cat.IsDefault) + "\n")
	}
	b.WriteString("\n")

	b.WriteString("[tag]\n")
	for _, tg := range tags {
		b.WriteString("  [tag." + tomlTableKey(tg.Key) + "]\n")
		b.WriteString("    name = " + fmt.Sprintf("%q", tg.Name) + "\n")
		b.WriteString("    color = " + fmt.Sprintf("%q", tg.Color) + "\n")
		b.WriteString("    sort_order = " + fmt.Sprintf("%d", tg.SortOrder) + "\n")
		b.WriteString("    scope_category = " + fmt.Sprintf("%q", tg.ScopeCategory) + "\n")
	}

	return b.String()
}

func cloneDefaultCategories() []taxonomyCategory {
	out := make([]taxonomyCategory, len(defaultTaxonomyCategories))
	copy(out, defaultTaxonomyCategories)
	return out
}

func cloneDefaultTags() []taxonomyTag {
	out := make([]taxonomyTag, len(defaultTaxonomyTags))
	copy(out, defaultTaxonomyTags)
	return out
}

func hasMandatoryIgnoreTag(tags []taxonomyTag) bool {
	for _, tg := range tags {
		if strings.EqualFold(strings.TrimSpace(tg.Name), mandatoryIgnoreTagName) {
			return true
		}
	}
	return false
}

func categoryKeySet(cats []taxonomyCategory) map[string]bool {
	out := make(map[string]bool, len(cats))
	for _, cat := range cats {
		out[cat.Key] = true
	}
	return out
}

func tagKeySet(tags []taxonomyTag) map[string]bool {
	out := make(map[string]bool, len(tags))
	for _, tg := range tags {
		out[tg.Key] = true
	}
	return out
}

func sortCategories(cats []taxonomyCategory) {
	sort.SliceStable(cats, func(i, j int) bool {
		if cats[i].SortOrder != cats[j].SortOrder {
			return cats[i].SortOrder < cats[j].SortOrder
		}
		return strings.ToLower(cats[i].Name) < strings.ToLower(cats[j].Name)
	})
}

func sortTags(tags []taxonomyTag) {
	sort.SliceStable(tags, func(i, j int) bool {
		if tags[i].SortOrder != tags[j].SortOrder {
			return tags[i].SortOrder < tags[j].SortOrder
		}
		return strings.ToLower(tags[i].Name) < strings.ToLower(tags[j].Name)
	})
}

func nextCategorySortOrder(cats []taxonomyCategory) int {
	maxOrder := 0
	for _, cat := range cats {
		if cat.SortOrder > maxOrder {
			maxOrder = cat.SortOrder
		}
	}
	return maxOrder + 1
}

func nextTagSortOrder(tags []taxonomyTag) int {
	maxOrder := 0
	for _, tg := range tags {
		if tg.SortOrder > maxOrder {
			maxOrder = tg.SortOrder
		}
	}
	return maxOrder + 1
}

func uniqueKeyFromName(name string, existing map[string]bool, fallbackPrefix string) string {
	key := slugify(name)
	if key == "" {
		key = fallbackPrefix
	}
	if !existing[key] {
		return key
	}
	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s_%d", key, i)
		if !existing[candidate] {
			return candidate
		}
	}
}

func slugify(s string) string {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" {
		return ""
	}
	var b strings.Builder
	lastUnderscore := false
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			b.WriteRune(r)
			lastUnderscore = false
			continue
		}
		if lastUnderscore {
			continue
		}
		b.WriteRune('_')
		lastUnderscore = true
	}
	out := strings.Trim(b.String(), "_")
	return out
}

func tomlTableKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return "\"\""
	}
	for _, r := range key {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '-' {
			continue
		}
		return fmt.Sprintf("%q", key)
	}
	return key
}
