package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

// csvFormat defines how to parse a bank CSV file.
type csvFormat struct {
	Name         string `toml:"name"`
	Account      string `toml:"account"`
	AccountType  string `toml:"account_type"`
	ImportPrefix string `toml:"import_prefix"`
	SortOrder    int    `toml:"sort_order"`
	IsActive     bool   `toml:"is_active"`
	Description  string `toml:"description"`
	DateFormat   string `toml:"date_format"`
	HasHeader    bool   `toml:"has_header"`
	Delimiter    string `toml:"delimiter"`
	DateCol      int    `toml:"date_col"`
	AmountCol    int    `toml:"amount_col"`
	DescCol      int    `toml:"desc_col"`     // starting column for description
	DescJoin     bool   `toml:"desc_join"`    // if true, join desc_col..end
	AmountStrip  string `toml:"amount_strip"` // chars to strip from amount
}

type configFile struct {
	Account       map[string]accountConfig `toml:"account"`
	Settings      appSettings              `toml:"settings"`
	SavedFilter   []savedFilter            `toml:"saved_filter"`
	DashboardView []customPaneMode         `toml:"dashboard_view"`
}

type accountConfig struct {
	Name         string `toml:"name"` // optional for table form; key is canonical name
	Type         string `toml:"type"`
	SortOrder    int    `toml:"sort_order"`
	IsActive     bool   `toml:"is_active"`
	ImportPrefix string `toml:"import_prefix"`
	Description  string `toml:"description"`
	DateFormat   string `toml:"date_format"`
	HasHeader    bool   `toml:"has_header"`
	Delimiter    string `toml:"delimiter"`
	DateCol      int    `toml:"date_col"`
	AmountCol    int    `toml:"amount_col"`
	DescCol      int    `toml:"desc_col"`
	DescJoin     bool   `toml:"desc_join"`
	AmountStrip  string `toml:"amount_strip"`
}

type appSettings struct {
	RowsPerPage             int    `toml:"rows_per_page"`
	SpendingWeekFrom        string `toml:"spending_week_from"` // "sunday" or "monday"
	DashTimeframe           int    `toml:"dash_timeframe"`
	DashCustomStart         string `toml:"dash_custom_start"`
	DashCustomEnd           string `toml:"dash_custom_end"`
	CommandDefaultInterface string `toml:"command_default_interface"` // "palette" or "colon"
}

type savedFilter struct {
	Name string `toml:"name"`
	Expr string `toml:"expr"`
}

type customPaneMode struct {
	Pane     string `toml:"pane"`
	Name     string `toml:"name"`
	Expr     string `toml:"expr"`
	ViewType string `toml:"view_type"`
}

type keybindingConfig struct {
	Scope  string   `toml:"scope"`
	Action string   `toml:"action"`
	Keys   []string `toml:"keys"`
}

type shortcutOverride struct {
	Scope  string   `toml:"scope"`
	Action string   `toml:"action"`
	Keys   []string `toml:"keys"`
}

type keybindingsFile struct {
	Version  int                 `toml:"version"`
	Bindings map[string][]string `toml:"bindings"`
}

const defaultConfigTOML = `# Jaskmoney config
# Account import profiles and app settings.

[account.ANZ]
type = "credit"
sort_order = 1
is_active = true
import_prefix = "anz"
description = "ANZ Australia bank export"
date_format = "2/01/2006"
has_header = false
delimiter = ","
date_col = 0
amount_col = 1
desc_col = 2
desc_join = true
amount_strip = ","

[settings]
rows_per_page = 20
spending_week_from = "sunday"
dash_timeframe = 0
dash_custom_start = ""
dash_custom_end = ""
command_default_interface = "palette"
`

func configDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("user config dir: %w", err)
	}
	return filepath.Join(dir, "jaskmoney"), nil
}

func configPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "config.toml"), nil
}

func keybindingsPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "keybindings.toml"), nil
}

func loadFormats() ([]csvFormat, error) {
	formats, _, err := loadAppConfig()
	return formats, err
}

func defaultSettings() appSettings {
	return appSettings{
		RowsPerPage:             20,
		SpendingWeekFrom:        "sunday",
		DashTimeframe:           dashTimeframeThisMonth,
		DashCustomStart:         "",
		DashCustomEnd:           "",
		CommandDefaultInterface: commandUIKindPalette,
	}
}

func defaultConfigFile() configFile {
	return configFile{
		Account:  formatsToAccountConfigs(defaultFormats()),
		Settings: defaultSettings(),
	}
}

func loadAppConfigExtended() ([]csvFormat, appSettings, []savedFilter, []customPaneMode, []string, error) {
	primaryPath, err := configPath()
	if err != nil {
		cfg := defaultConfigFile()
		return defaultFormats(), cfg.Settings, nil, nil, nil, err
	}

	if !fileExists(primaryPath) {
		cfg := defaultConfigFile()
		if wErr := writeConfigFile(primaryPath, cfg); wErr != nil {
			return defaultFormats(), cfg.Settings, nil, nil, nil, fmt.Errorf("write default config: %w", wErr)
		}
		return defaultFormats(), cfg.Settings, nil, nil, nil, nil
	}

	data, err := os.ReadFile(primaryPath)
	if err != nil {
		cfg := defaultConfigFile()
		if wErr := writeConfigFile(primaryPath, cfg); wErr != nil {
			return defaultFormats(), cfg.Settings, nil, nil, nil, fmt.Errorf("read config: %w; write default config: %v", err, wErr)
		}
		return defaultFormats(), cfg.Settings, nil, nil, []string{fmt.Sprintf("config reset to defaults after read error: %v", err)}, nil
	}

	formats, settings, _, saved, customModes, warnings, parseErr := parseConfigExt(data)
	if parseErr != nil {
		cfg := defaultConfigFile()
		if wErr := writeConfigFile(primaryPath, cfg); wErr != nil {
			return defaultFormats(), cfg.Settings, nil, nil, nil, fmt.Errorf("parse config: %w; write default config: %v", parseErr, wErr)
		}
		return defaultFormats(), cfg.Settings, nil, nil, []string{fmt.Sprintf("config reset to defaults after parse error: %v", parseErr)}, nil
	}

	return formats, settings, saved, customModes, warnings, nil
}

func loadAppConfig() ([]csvFormat, appSettings, error) {
	formats, settings, _, _, _, err := loadAppConfigExtended()
	return formats, settings, err
}

func loadKeybindingsConfig() ([]keybindingConfig, error) {
	defaults := NewKeyRegistry().ExportKeybindingConfig()
	primaryPath, err := keybindingsPath()
	if err != nil {
		return defaults, err
	}

	if !fileExists(primaryPath) {
		if err := writeKeybindingsFile(primaryPath, defaults); err != nil {
			return defaults, fmt.Errorf("write default keybindings: %w", err)
		}
		return defaults, nil
	}

	data, err := os.ReadFile(primaryPath)
	if err != nil {
		if writeErr := writeKeybindingsFile(primaryPath, defaults); writeErr != nil {
			return defaults, fmt.Errorf("read keybindings: %w; write default keybindings: %v", err, writeErr)
		}
		return defaults, nil
	}

	parsed, err := parseKeybindingsConfig(data, defaults)
	if err != nil {
		if writeErr := writeKeybindingsFile(primaryPath, defaults); writeErr != nil {
			return defaults, fmt.Errorf("parse keybindings: %w; write default keybindings: %v", err, writeErr)
		}
		return defaults, nil
	}
	materialized, changed, err := materializeKeybindings(defaults, parsed)
	if err != nil {
		if writeErr := writeKeybindingsFile(primaryPath, defaults); writeErr != nil {
			return defaults, fmt.Errorf("validate keybindings: %w; write default keybindings: %v", err, writeErr)
		}
		return defaults, nil
	}
	if changed {
		if err := writeKeybindingsFile(primaryPath, materialized); err != nil {
			return materialized, fmt.Errorf("write keybindings template: %w", err)
		}
	}
	return materialized, nil
}

func parseFormats(data []byte) ([]csvFormat, error) {
	formats, _, _, _, _, _, err := parseConfigExt(data)
	return formats, err
}

func parseConfig(data []byte) ([]csvFormat, appSettings, []keybindingConfig, error) {
	formats, settings, bindings, _, _, _, err := parseConfigExt(data)
	return formats, settings, bindings, err
}

func parseConfigExt(data []byte) ([]csvFormat, appSettings, []keybindingConfig, []savedFilter, []customPaneMode, []string, error) {
	var cfg configFile
	if err := toml.Unmarshal(data, &cfg); err != nil {
		return nil, defaultSettings(), nil, nil, nil, nil, fmt.Errorf("parse config.toml: %w", err)
	}
	formats := make([]csvFormat, 0)
	if len(cfg.Account) > 0 {
		type namedFormat struct {
			name string
			fmt  csvFormat
		}
		items := make([]namedFormat, 0, len(cfg.Account))
		for key, raw := range cfg.Account {
			name := strings.TrimSpace(key)
			if strings.TrimSpace(raw.Name) != "" {
				name = strings.TrimSpace(raw.Name)
			}
			if name == "" {
				return nil, defaultSettings(), nil, nil, nil, nil, fmt.Errorf("account table key is required")
			}
			if strings.TrimSpace(raw.DateFormat) == "" {
				return nil, defaultSettings(), nil, nil, nil, nil, fmt.Errorf("account %q: date_format is required", name)
			}
			acctType := normalizeAccountType(raw.Type)
			importPrefix := strings.TrimSpace(raw.ImportPrefix)
			if importPrefix == "" {
				importPrefix = strings.ToLower(name)
			}
			sortOrder := raw.SortOrder
			if sortOrder <= 0 {
				sortOrder = 1
			}
			items = append(items, namedFormat{
				name: name,
				fmt: csvFormat{
					Name:         name,
					Account:      name,
					AccountType:  acctType,
					ImportPrefix: importPrefix,
					SortOrder:    sortOrder,
					IsActive:     raw.IsActive,
					Description:  raw.Description,
					DateFormat:   raw.DateFormat,
					HasHeader:    raw.HasHeader,
					Delimiter:    raw.Delimiter,
					DateCol:      raw.DateCol,
					AmountCol:    raw.AmountCol,
					DescCol:      raw.DescCol,
					DescJoin:     raw.DescJoin,
					AmountStrip:  raw.AmountStrip,
				},
			})
		}
		sort.Slice(items, func(i, j int) bool {
			if items[i].fmt.SortOrder != items[j].fmt.SortOrder {
				return items[i].fmt.SortOrder < items[j].fmt.SortOrder
			}
			return strings.ToLower(items[i].name) < strings.ToLower(items[j].name)
		})
			for _, item := range items {
				formats = append(formats, item.fmt)
			}
		}
		if len(formats) == 0 {
		return nil, defaultSettings(), nil, nil, nil, nil, fmt.Errorf("no account formats defined in config")
	}
	for i := range formats {
		f := &formats[i]
		if f.Name == "" {
			return nil, defaultSettings(), nil, nil, nil, nil, fmt.Errorf("format[%d]: name is required", i)
		}
		if f.DateFormat == "" {
			return nil, defaultSettings(), nil, nil, nil, nil, fmt.Errorf("format[%d] %q: date_format is required", i, f.Name)
		}
		if strings.TrimSpace(f.Account) == "" {
			f.Account = f.Name
		}
		if strings.TrimSpace(f.AccountType) == "" {
			f.AccountType = inferAccountTypeFromName(f.Account)
		}
		f.AccountType = normalizeAccountType(f.AccountType)
		if strings.TrimSpace(f.ImportPrefix) == "" {
			f.ImportPrefix = strings.ToLower(f.Name)
		}
		if f.SortOrder <= 0 {
			f.SortOrder = i + 1
		}
	}

	settings := normalizeSettings(cfg.Settings)
	saved, customModes, warnings := normalizeFilterConfigEntries(cfg.SavedFilter, cfg.DashboardView)
	return formats, settings, nil, saved, customModes, warnings, nil
}

func normalizeFilterConfigEntries(savedIn []savedFilter, customIn []customPaneMode) ([]savedFilter, []customPaneMode, []string) {
	savedOut := make([]savedFilter, 0, len(savedIn))
	customOut := make([]customPaneMode, 0, len(customIn))
	warnings := make([]string, 0)

	for i, sf := range savedIn {
		name := strings.TrimSpace(sf.Name)
		expr := strings.TrimSpace(sf.Expr)
		if name == "" {
			warnings = append(warnings, fmt.Sprintf("saved_filter[%d] skipped: name is required", i))
			continue
		}
		if expr == "" {
			warnings = append(warnings, fmt.Sprintf("saved_filter %q skipped: expr is required", name))
			continue
		}
		node, err := parseFilterStrict(expr)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("saved_filter %q skipped: %v", name, err))
			continue
		}
		savedOut = append(savedOut, savedFilter{
			Name: name,
			Expr: filterExprString(node),
		})
	}

	for i, mode := range customIn {
		pane := strings.ToLower(strings.TrimSpace(mode.Pane))
		name := strings.TrimSpace(mode.Name)
		expr := strings.TrimSpace(mode.Expr)
		viewType := strings.ToLower(strings.TrimSpace(mode.ViewType))
		if pane == "" {
			warnings = append(warnings, fmt.Sprintf("dashboard_view[%d] skipped: pane is required", i))
			continue
		}
		if name == "" {
			warnings = append(warnings, fmt.Sprintf("dashboard_view[%d] skipped: name is required", i))
			continue
		}
		if expr == "" {
			warnings = append(warnings, fmt.Sprintf("dashboard_view[%d] %q skipped: expr is required", i, name))
			continue
		}
		if !isKnownDashboardPaneID(pane) {
			warnings = append(warnings, fmt.Sprintf("dashboard_view[%d] %q skipped: unknown pane %q", i, name, pane))
			continue
		}
		if viewType != "" && !isKnownDashboardViewType(viewType) {
			warnings = append(warnings, fmt.Sprintf("dashboard_view[%d] %q skipped: invalid view_type %q", i, name, viewType))
			continue
		}
		node, err := parseFilterStrict(expr)
		if err != nil {
			warnings = append(warnings, fmt.Sprintf("dashboard_view[%d] %q skipped: %v", i, name, err))
			continue
		}
		customOut = append(customOut, customPaneMode{
			Pane:     pane,
			Name:     name,
			Expr:     filterExprString(node),
			ViewType: viewType,
		})
	}

	return savedOut, customOut, warnings
}

func isKnownDashboardPaneID(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "net_cashflow", "composition", "compare_bars", "budget_health":
		return true
	default:
		return false
	}
}

func isKnownDashboardViewType(v string) bool {
	switch strings.ToLower(strings.TrimSpace(v)) {
	case "line", "area", "bar", "pie", "table":
		return true
	default:
		return false
	}
}

func parseKeybindingsConfig(data []byte, defaults []keybindingConfig) ([]keybindingConfig, error) {
	var cfg keybindingsFile
	if err := toml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse keybindings.toml: %w", err)
	}
	if cfg.Version == 0 {
		cfg.Version = 2
	}
	if cfg.Version != 2 {
		return nil, fmt.Errorf("unsupported keybindings version: %d", cfg.Version)
	}
	actionKeys, err := parseActionBindings(cfg.Bindings, defaults)
	if err != nil {
		return nil, err
	}
	return expandActionOverrides(defaults, actionKeys), nil
}

func parseActionBindings(bindings map[string][]string, defaults []keybindingConfig) (map[string][]string, error) {
	knownActions := make(map[string]bool)
	for _, d := range defaults {
		knownActions[d.Action] = true
	}
	out := make(map[string][]string)
	for rawAction, rawKeys := range bindings {
		action := strings.TrimSpace(rawAction)
		keys := normalizeKeyList(rawKeys)
		if !knownActions[action] {
			return nil, unknownActionError("keybindings", action, knownActions)
		}
		if len(keys) == 0 {
			return nil, fmt.Errorf("keybindings action=%q: keys are required", action)
		}
		out[action] = keys
	}
	return out, nil
}

func expandActionOverrides(defaults []keybindingConfig, actionKeys map[string][]string) []keybindingConfig {
	out := make([]keybindingConfig, 0, len(defaults))
	for _, d := range defaults {
		keys := d.Keys
		if override, ok := actionKeys[d.Action]; ok {
			keys = override
		}
		out = append(out, keybindingConfig{Scope: d.Scope, Action: d.Action, Keys: keys})
	}
	return normalizeKeybindings(out)
}

func unknownActionError(prefix, action string, knownActions map[string]bool) error {
	suggestion := suggestedActionName(action, knownActions)
	if suggestion != "" {
		return fmt.Errorf("%s: unknown action %q (did you mean %q?)", prefix, action, suggestion)
	}
	return fmt.Errorf("%s: unknown action %q (run `go run . -startup-check` for startup diagnostics)", prefix, action)
}

func suggestedActionName(action string, knownActions map[string]bool) string {
	a := strings.ToLower(strings.TrimSpace(action))
	switch {
	case strings.Contains(a, "confirm") && knownActions[string(actionConfirm)]:
		return string(actionConfirm)
	case strings.Contains(a, "cancel") && knownActions[string(actionCancel)]:
		return string(actionCancel)
	case strings.Contains(a, "close") && knownActions[string(actionClose)]:
		return string(actionClose)
	case strings.Contains(a, "move") && knownActions[string(actionDown)]:
		return string(actionDown)
	case strings.Contains(a, "sort") && knownActions[string(actionSort)]:
		return string(actionSort)
	}
	return ""
}
func normalizeKeybindings(in []keybindingConfig) []keybindingConfig {
	out := make([]keybindingConfig, 0, len(in))
	for _, b := range in {
		keys := normalizeKeyList(b.Keys)
		out = append(out, keybindingConfig{
			Scope:  strings.TrimSpace(b.Scope),
			Action: strings.TrimSpace(b.Action),
			Keys:   keys,
		})
	}
	return out
}

func materializeKeybindings(defaults, fileBindings []keybindingConfig) ([]keybindingConfig, bool, error) {
	type pair struct {
		scope  string
		action string
	}
	defaultByPair := make(map[pair]keybindingConfig, len(defaults))
	for _, d := range defaults {
		defaultByPair[pair{scope: d.Scope, action: d.Action}] = d
	}

	mergedByPair := make(map[pair]keybindingConfig, len(defaults))
	for _, d := range defaults {
		mergedByPair[pair{scope: d.Scope, action: d.Action}] = d
	}

	changed := false
	seenPairs := make(map[pair]bool)
	for _, b := range fileBindings {
		p := pair{scope: b.Scope, action: b.Action}
		if seenPairs[p] {
			return nil, false, fmt.Errorf("keybinding duplicated for scope=%q action=%q", b.Scope, b.Action)
		}
		seenPairs[p] = true

		if _, ok := defaultByPair[p]; !ok {
			return nil, false, fmt.Errorf("unknown keybinding scope/action: %q/%q", b.Scope, b.Action)
		}
		if len(b.Keys) == 0 {
			return nil, false, fmt.Errorf("keybinding scope=%q action=%q: keys are required", b.Scope, b.Action)
		}
		mergedByPair[p] = keybindingConfig{Scope: b.Scope, Action: b.Action, Keys: b.Keys}
		if !equalStringSlices(b.Keys, defaultByPair[p].Keys) {
			changed = true
		}
	}

	if len(fileBindings) != len(defaults) {
		changed = true
	}

	out := make([]keybindingConfig, 0, len(defaults))
	for _, d := range defaults {
		p := pair{scope: d.Scope, action: d.Action}
		out = append(out, mergedByPair[p])
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Scope != out[j].Scope {
			return out[i].Scope < out[j].Scope
		}
		return out[i].Action < out[j].Action
	})
	if migrated := migrateManagerQuickTagConflict(out, defaults); migrated {
		changed = true
	}

	if err := validateKeybindingConflicts(out); err != nil {
		return nil, false, err
	}
	return out, changed, nil
}

func migrateManagerQuickTagConflict(bindings []keybindingConfig, defaults []keybindingConfig) bool {
	const (
		managerScope   = "manager"
		quickTagAction = "quick_tag"
	)
	quickIdx := -1
	used := make(map[string]bool)
	for i, b := range bindings {
		if b.Scope != managerScope {
			continue
		}
		if b.Action == quickTagAction {
			quickIdx = i
			continue
		}
		for _, k := range normalizeKeyList(b.Keys) {
			used[k] = true
		}
	}
	if quickIdx < 0 {
		return false
	}
	quickKeys := normalizeKeyList(bindings[quickIdx].Keys)
	hasConflict := false
	for _, k := range quickKeys {
		if used[k] {
			hasConflict = true
			break
		}
	}
	if !hasConflict {
		return false
	}

	defaultQuickKeys := []string{"T"}
	for _, d := range defaults {
		if d.Scope == managerScope && d.Action == quickTagAction {
			keys := normalizeKeyList(d.Keys)
			if len(keys) > 0 {
				defaultQuickKeys = keys
			}
			break
		}
	}
	conflictFree := true
	for _, k := range defaultQuickKeys {
		if used[k] {
			conflictFree = false
			break
		}
	}
	if conflictFree {
		bindings[quickIdx].Keys = defaultQuickKeys
		return true
	}

	for _, candidate := range []string{"T", "ctrl+t", "alt+t"} {
		c := normalizeKeyName(candidate)
		if c != "" && !used[c] {
			bindings[quickIdx].Keys = []string{c}
			return true
		}
	}
	return false
}

func validateKeybindingConflicts(bindings []keybindingConfig) error {
	seen := make(map[string]map[string]string)
	for _, b := range bindings {
		if _, ok := seen[b.Scope]; !ok {
			seen[b.Scope] = make(map[string]string)
		}
		for _, k := range normalizeKeyList(b.Keys) {
			if prev, exists := seen[b.Scope][k]; exists {
				return fmt.Errorf("keybinding conflict in scope=%q: key %q used by %q and %q", b.Scope, k, prev, b.Action)
			}
			seen[b.Scope][k] = b.Action
		}
	}
	return nil
}

func normalizeSettings(s appSettings) appSettings {
	out := defaultSettings()
	if s.RowsPerPage >= 5 && s.RowsPerPage <= 50 {
		out.RowsPerPage = s.RowsPerPage
	}
	switch strings.ToLower(strings.TrimSpace(s.SpendingWeekFrom)) {
	case "monday":
		out.SpendingWeekFrom = "monday"
	default:
		out.SpendingWeekFrom = "sunday"
	}
	if s.DashTimeframe >= 0 && s.DashTimeframe < dashTimeframeCount {
		out.DashTimeframe = s.DashTimeframe
	}
	out.DashCustomStart = strings.TrimSpace(s.DashCustomStart)
	out.DashCustomEnd = strings.TrimSpace(s.DashCustomEnd)
	if out.DashCustomStart != "" {
		if _, err := time.Parse("2006-01-02", out.DashCustomStart); err != nil {
			out.DashCustomStart = ""
		}
	}
	if out.DashCustomEnd != "" {
		if _, err := time.Parse("2006-01-02", out.DashCustomEnd); err != nil {
			out.DashCustomEnd = ""
		}
	}
	switch strings.ToLower(strings.TrimSpace(s.CommandDefaultInterface)) {
	case commandUIKindColon:
		out.CommandDefaultInterface = commandUIKindColon
	default:
		out.CommandDefaultInterface = commandUIKindPalette
	}
	return out
}

func saveAppSettings(s appSettings) error {
	primaryPath, err := configPath()
	if err != nil {
		return err
	}
	formats, _, saved, customModes, _, loadErr := loadAppConfigExtended()
	if loadErr != nil {
		return loadErr
	}
	cfg := configFile{
		Account:       formatsToAccountConfigs(formats),
		Settings:      normalizeSettings(s),
		SavedFilter:   saved,
		DashboardView: customModes,
	}
	return writeConfigFile(primaryPath, cfg)
}

func saveFormats(formats []csvFormat) error {
	primaryPath, err := configPath()
	if err != nil {
		return err
	}
	_, settings, saved, customModes, _, loadErr := loadAppConfigExtended()
	if loadErr != nil {
		return loadErr
	}
	cfg := configFile{
		Account:       formatsToAccountConfigs(formats),
		Settings:      normalizeSettings(settings),
		SavedFilter:   saved,
		DashboardView: customModes,
	}
	return writeConfigFile(primaryPath, cfg)
}

func saveSavedFilters(saved []savedFilter) error {
	primaryPath, err := configPath()
	if err != nil {
		return err
	}
	formats, settings, _, customModes, _, loadErr := loadAppConfigExtended()
	if loadErr != nil {
		return loadErr
	}
	cfg := configFile{
		Account:       formatsToAccountConfigs(formats),
		Settings:      normalizeSettings(settings),
		SavedFilter:   saved,
		DashboardView: customModes,
	}
	return writeConfigFile(primaryPath, cfg)
}

func upsertFormatForAccount(name, acctType string) error {
	formats, _, err := loadAppConfig()
	if err != nil {
		return err
	}
	target := strings.TrimSpace(name)
	if target == "" {
		return fmt.Errorf("account name is required")
	}
	for i := range formats {
		if strings.EqualFold(strings.TrimSpace(formats[i].Account), target) || strings.EqualFold(strings.TrimSpace(formats[i].Name), target) {
			formats[i].Account = target
			formats[i].Name = target
			formats[i].AccountType = normalizeAccountType(acctType)
			if strings.TrimSpace(formats[i].ImportPrefix) == "" {
				formats[i].ImportPrefix = strings.ToLower(target)
			}
			return saveFormats(formats)
		}
	}

	base := defaultFormats()[0]
	base.Name = target
	base.Account = target
	base.AccountType = normalizeAccountType(acctType)
	base.ImportPrefix = strings.ToLower(target)
	base.SortOrder = len(formats) + 1
	base.IsActive = true
	formats = append(formats, base)
	return saveFormats(formats)
}

func removeFormatForAccount(name string) error {
	formats, _, err := loadAppConfig()
	if err != nil {
		return err
	}
	target := strings.TrimSpace(name)
	if target == "" {
		return fmt.Errorf("account name is required")
	}
	out := make([]csvFormat, 0, len(formats))
	for _, f := range formats {
		if strings.EqualFold(strings.TrimSpace(f.Account), target) || strings.EqualFold(strings.TrimSpace(f.Name), target) {
			continue
		}
		out = append(out, f)
	}
	return saveFormats(out)
}

func writeConfigFile(path string, cfg configFile) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	var buf bytes.Buffer
	if err := toml.NewEncoder(&buf).Encode(cfg); err != nil {
		return fmt.Errorf("encode config.toml: %w", err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0o644); err != nil {
		return fmt.Errorf("write config.toml: %w", err)
	}
	return nil
}

func writeKeybindingsFile(path string, bindings []keybindingConfig) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	data := renderKeybindingsTemplate(bindings)
	if err := os.WriteFile(path, []byte(data), 0o644); err != nil {
		return fmt.Errorf("write keybindings.toml: %w", err)
	}
	return nil
}

func resetKeybindingsFileToDefaults() error {
	path, err := keybindingsPath()
	if err != nil {
		return err
	}
	if fileExists(path) {
		if err := os.Remove(path); err != nil {
			return fmt.Errorf("remove keybindings.toml: %w", err)
		}
	}
	defaults := NewKeyRegistry().ExportKeybindingConfig()
	if err := writeKeybindingsFile(path, defaults); err != nil {
		return fmt.Errorf("write default keybindings: %w", err)
	}
	return nil
}

func renderKeybindingsTemplate(bindings []keybindingConfig) string {
	var buf strings.Builder
	buf.WriteString("version = 2\n\n")
	buf.WriteString("# Action-level key overrides.\n")
	buf.WriteString("# Each action applies across all tabs/scopes where that action exists.\n")
	buf.WriteString("# Display labels and scope routing are defined in code.\n\n")
	buf.WriteString("[bindings]\n")

	actionDefaults := make(map[string][]string)
	for _, b := range bindings {
		if _, ok := actionDefaults[b.Action]; ok {
			continue
		}
		actionDefaults[b.Action] = append([]string(nil), b.Keys...)
	}

	type actionGroup struct {
		header  string
		actions []string
	}
	groups := []actionGroup{
		{
			header: "# Universal primitives",
			actions: []string{
				string(actionConfirm),
				string(actionCancel),
				string(actionUp),
				string(actionDown),
				string(actionLeft),
				string(actionRight),
				string(actionDelete),
				string(actionNextTab),
				string(actionPrevTab),
				string(actionQuit),
			},
		},
		{
			header: "# Global app and command interfaces",
			actions: []string{
				string(actionCommandGoTransactions),
				string(actionCommandGoDashboard),
				string(actionCommandGoSettings),
				string(actionCommandPalette),
				string(actionCommandMode),
				string(actionCommandDefault),
			},
		},
		{
			header: "# Transactions and manager workflows",
			actions: []string{
				string(actionSearch),
				string(actionFilterSave),
				string(actionFilterLoad),
				string(actionSort),
				string(actionSortDirection),
				string(actionToggleSelect),
				string(actionRangeHighlight),
				string(actionQuickCategory),
				string(actionQuickTag),
				string(actionCommandClearSelection),
				string(actionJumpTop),
				string(actionJumpBottom),
				string(actionTimeframe),
				string(actionFocusAccounts),
			},
		},
			{
				header: "# Settings and import workflows",
				actions: []string{
				string(actionAdd),
				string(actionEdit),
				string(actionSave),
				string(actionApplyAll),
				string(actionImport),
				string(actionImportAll),
				string(actionSkipDupes),
					string(actionClearDB),
					string(actionRowsPerPage),
					string(actionResetKeybindings),
				},
			},
	}

	printed := make(map[string]bool, len(actionDefaults))
	writeGroup := func(header string, actions []string) {
		wroteHeader := false
		for _, action := range actions {
			keys, ok := actionDefaults[action]
			if !ok || printed[action] {
				continue
			}
			if !wroteHeader {
				if len(printed) > 0 {
					buf.WriteString("\n")
				}
				buf.WriteString(header)
				buf.WriteString("\n")
				wroteHeader = true
			}
			buf.WriteString(fmt.Sprintf("%s = %s\n", action, formatTomlStringArray(keys)))
			printed[action] = true
		}
	}
	for _, group := range groups {
		writeGroup(group.header, group.actions)
	}

	remaining := make([]string, 0, len(actionDefaults))
	for action := range actionDefaults {
		if !printed[action] {
			remaining = append(remaining, action)
		}
	}
	sort.Strings(remaining)
	if len(remaining) > 0 {
		if len(printed) > 0 {
			buf.WriteString("\n")
		}
		buf.WriteString("# Other actions\n")
		for _, action := range remaining {
			buf.WriteString(fmt.Sprintf("%s = %s\n", action, formatTomlStringArray(actionDefaults[action])))
		}
	}

	return buf.String()
}

func formatTomlStringArray(items []string) string {
	if len(items) == 0 {
		return "[]"
	}
	parts := make([]string, 0, len(items))
	for _, item := range items {
		parts = append(parts, fmt.Sprintf("%q", item))
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

func fileExists(path string) bool {
	if path == "" {
		return false
	}
	_, err := os.Stat(path)
	return err == nil
}

func defaultFormats() []csvFormat {
	return []csvFormat{
		{
			Name:         "ANZ",
			Account:      "ANZ",
			AccountType:  "credit",
			ImportPrefix: "anz",
			SortOrder:    1,
			IsActive:     true,
			Description:  "ANZ Australia bank export",
			DateFormat:   "2/01/2006",
			HasHeader:    false,
			Delimiter:    ",",
			DateCol:      0,
			AmountCol:    1,
			DescCol:      2,
			DescJoin:     true,
			AmountStrip:  ",",
		},
	}
}

func formatsToAccountConfigs(formats []csvFormat) map[string]accountConfig {
	out := make(map[string]accountConfig)
	for i, f := range formats {
		name := strings.TrimSpace(f.Account)
		if name == "" {
			name = strings.TrimSpace(f.Name)
		}
		if name == "" {
			continue
		}
		sortOrder := f.SortOrder
		if sortOrder <= 0 {
			sortOrder = i + 1
		}
		importPrefix := strings.TrimSpace(f.ImportPrefix)
		if importPrefix == "" {
			importPrefix = strings.ToLower(name)
		}
		acctType := strings.TrimSpace(f.AccountType)
		if acctType == "" {
			acctType = inferAccountTypeFromName(name)
		}
		out[name] = accountConfig{
			Type:         normalizeAccountType(acctType),
			SortOrder:    sortOrder,
			IsActive:     f.IsActive,
			ImportPrefix: importPrefix,
			Description:  f.Description,
			DateFormat:   f.DateFormat,
			HasHeader:    f.HasHeader,
			Delimiter:    f.Delimiter,
			DateCol:      f.DateCol,
			AmountCol:    f.AmountCol,
			DescCol:      f.DescCol,
			DescJoin:     f.DescJoin,
			AmountStrip:  f.AmountStrip,
		}
	}
	return out
}

func normalizeAccountType(v string) string {
	if strings.EqualFold(strings.TrimSpace(v), "credit") {
		return "credit"
	}
	return "debit"
}

func inferAccountTypeFromName(name string) string {
	if strings.EqualFold(strings.TrimSpace(name), "ANZ") {
		return "credit"
	}
	return "debit"
}

func findFormat(formats []csvFormat, name string) *csvFormat {
	for i := range formats {
		if strings.EqualFold(formats[i].Name, name) {
			return &formats[i]
		}
	}
	return nil
}

func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
