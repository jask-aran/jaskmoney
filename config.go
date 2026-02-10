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
	Account          map[string]accountConfig `toml:"account"`
	Format           []csvFormat              `toml:"format"` // legacy fallback
	Settings         appSettings              `toml:"settings"`
	Keybinding       []keybindingConfig       `toml:"keybinding"`        // legacy fallback
	ShortcutOverride []shortcutOverride       `toml:"shortcut_override"` // legacy fallback
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
	RowsPerPage      int    `toml:"rows_per_page"`
	SpendingWeekFrom string `toml:"spending_week_from"` // "sunday" or "monday"
	DashTimeframe    int    `toml:"dash_timeframe"`
	DashCustomStart  string `toml:"dash_custom_start"`
	DashCustomEnd    string `toml:"dash_custom_end"`
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
	Version  int                               `toml:"version"`
	Profiles map[string]map[string][]string    `toml:"profiles"`
	Scopes   map[string]keybindingsScopeConfig `toml:"scopes"`
}

type keybindingsScopeConfig struct {
	Use  []string            `toml:"use"`
	Bind map[string][]string `toml:"bind"`
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

func legacyConfigPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "formats.toml"), nil
}

func appConfigPath() (string, error) {
	cwd, err := os.Getwd()
	if err != nil || strings.TrimSpace(cwd) == "" {
		return "", err
	}
	return filepath.Join(cwd, "config.toml"), nil
}

func appKeybindingsPath() (string, error) {
	cwd, err := os.Getwd()
	if err != nil || strings.TrimSpace(cwd) == "" {
		return "", err
	}
	return filepath.Join(cwd, "keybindings.toml"), nil
}

func appLegacyConfigPath() (string, error) {
	cwd, err := os.Getwd()
	if err != nil || strings.TrimSpace(cwd) == "" {
		return "", err
	}
	return filepath.Join(cwd, "formats.toml"), nil
}

func loadFormats() ([]csvFormat, error) {
	formats, _, err := loadAppConfig()
	return formats, err
}

func defaultSettings() appSettings {
	return appSettings{
		RowsPerPage:      20,
		SpendingWeekFrom: "sunday",
		DashTimeframe:    dashTimeframeThisMonth,
		DashCustomStart:  "",
		DashCustomEnd:    "",
	}
}

func defaultConfigFile() configFile {
	return configFile{
		Account:  formatsToAccountConfigs(defaultFormats()),
		Settings: defaultSettings(),
	}
}

func loadAppConfig() ([]csvFormat, appSettings, error) {
	primaryPath, err := configPath()
	if err != nil {
		cfg := defaultConfigFile()
		return defaultFormats(), cfg.Settings, err
	}
	legacyPath, _ := legacyConfigPath()
	appPath, _ := appConfigPath()
	appLegacyPath, _ := appLegacyConfigPath()

	candidates := []string{primaryPath, legacyPath, appPath, appLegacyPath}
	sourcePath := ""
	for _, p := range candidates {
		if fileExists(p) {
			sourcePath = p
			break
		}
	}

	if sourcePath == "" {
		cfg := defaultConfigFile()
		if wErr := writeConfigFile(primaryPath, cfg); wErr != nil {
			return defaultFormats(), cfg.Settings, fmt.Errorf("write default config: %w", wErr)
		}
		return defaultFormats(), cfg.Settings, nil
	}

	data, err := os.ReadFile(sourcePath)
	if err != nil {
		cfg := defaultConfigFile()
		return defaultFormats(), cfg.Settings, fmt.Errorf("read config: %w", err)
	}

	formats, settings, _, parseErr := parseConfig(data)
	if parseErr != nil {
		cfg := defaultConfigFile()
		return defaultFormats(), cfg.Settings, parseErr
	}

	if sourcePath != primaryPath {
		cfg := configFile{Account: formatsToAccountConfigs(formats), Settings: settings}
		if wErr := writeConfigFile(primaryPath, cfg); wErr != nil {
			return formats, settings, fmt.Errorf("write migrated config: %w", wErr)
		}
	}

	return formats, settings, nil
}

func loadKeybindingsConfig() ([]keybindingConfig, error) {
	defaults := NewKeyRegistry().ExportKeybindingConfig()
	primaryPath, err := keybindingsPath()
	if err != nil {
		return defaults, err
	}

	if fileExists(primaryPath) {
		data, err := os.ReadFile(primaryPath)
		if err != nil {
			return defaults, fmt.Errorf("read keybindings: %w", err)
		}
		parsed, err := parseKeybindingsConfig(data, defaults)
		if err != nil {
			return defaults, err
		}
		materialized, changed, err := materializeKeybindings(defaults, parsed)
		if err != nil {
			return defaults, err
		}
		if changed {
			if err := writeKeybindingsFile(primaryPath, materialized); err != nil {
				return materialized, fmt.Errorf("write keybindings template: %w", err)
			}
		}
		return materialized, nil
	}

	legacy, found, err := loadLegacyKeybindingOverrides(defaults)
	if err != nil {
		return defaults, err
	}
	if found {
		materialized, _, err := materializeKeybindings(defaults, legacy)
		if err != nil {
			return defaults, err
		}
		if err := writeKeybindingsFile(primaryPath, materialized); err != nil {
			return materialized, fmt.Errorf("write keybindings template: %w", err)
		}
		return materialized, nil
	}

	if err := writeKeybindingsFile(primaryPath, defaults); err != nil {
		return defaults, fmt.Errorf("write default keybindings: %w", err)
	}
	return defaults, nil
}

func loadLegacyKeybindingOverrides(defaults []keybindingConfig) ([]keybindingConfig, bool, error) {
	userCfg, _ := configPath()
	userLegacyCfg, _ := legacyConfigPath()
	appKB, _ := appKeybindingsPath()
	appCfg, _ := appConfigPath()
	appLegacyCfg, _ := appLegacyConfigPath()

	type candidate struct {
		path string
		kind string
	}
	candidates := []candidate{
		{path: userCfg, kind: "legacy_config"},
		{path: userLegacyCfg, kind: "legacy_config"},
		{path: appKB, kind: "keybindings"},
		{path: appCfg, kind: "legacy_config"},
		{path: appLegacyCfg, kind: "legacy_config"},
	}

	for _, c := range candidates {
		if !fileExists(c.path) {
			continue
		}
		data, err := os.ReadFile(c.path)
		if err != nil {
			return nil, false, fmt.Errorf("read legacy keybindings source %s: %w", c.path, err)
		}
		switch c.kind {
		case "keybindings":
			items, err := parseKeybindingsConfig(data, defaults)
			if err != nil {
				return nil, false, err
			}
			return items, true, nil
		default:
			items, err := parseLegacyKeybindingsFromConfig(data)
			if err != nil {
				return nil, false, err
			}
			if len(items) > 0 {
				return items, true, nil
			}
		}
	}

	return nil, false, nil
}

func parseLegacyKeybindingsFromConfig(data []byte) ([]keybindingConfig, error) {
	var cfg configFile
	if err := toml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse legacy config keybindings: %w", err)
	}
	bindings := normalizeKeybindings(cfg.Keybinding)
	if len(bindings) == 0 && len(cfg.ShortcutOverride) > 0 {
		bindings = legacyOverridesToKeybindings(normalizeShortcutOverrides(cfg.ShortcutOverride))
	}
	return bindings, nil
}

func parseFormats(data []byte) ([]csvFormat, error) {
	formats, _, _, err := parseConfig(data)
	return formats, err
}

func parseConfig(data []byte) ([]csvFormat, appSettings, []keybindingConfig, error) {
	var cfg configFile
	if err := toml.Unmarshal(data, &cfg); err != nil {
		return nil, defaultSettings(), nil, fmt.Errorf("parse config.toml: %w", err)
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
				return nil, defaultSettings(), nil, fmt.Errorf("account table key is required")
			}
			if strings.TrimSpace(raw.DateFormat) == "" {
				return nil, defaultSettings(), nil, fmt.Errorf("account %q: date_format is required", name)
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
	} else {
		formats = append(formats, cfg.Format...)
	}
	if len(formats) == 0 {
		return nil, defaultSettings(), nil, fmt.Errorf("no account formats defined in config")
	}
	for i := range formats {
		f := &formats[i]
		if f.Name == "" {
			return nil, defaultSettings(), nil, fmt.Errorf("format[%d]: name is required", i)
		}
		if f.DateFormat == "" {
			return nil, defaultSettings(), nil, fmt.Errorf("format[%d] %q: date_format is required", i, f.Name)
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
	bindings := normalizeKeybindings(cfg.Keybinding)
	if len(bindings) == 0 && len(cfg.ShortcutOverride) > 0 {
		bindings = legacyOverridesToKeybindings(normalizeShortcutOverrides(cfg.ShortcutOverride))
	}
	return formats, settings, bindings, nil
}

func parseKeybindingsConfig(data []byte, defaults []keybindingConfig) ([]keybindingConfig, error) {
	var cfg keybindingsFile
	if err := toml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse keybindings.toml: %w", err)
	}
	if cfg.Version == 0 {
		cfg.Version = 1
	}
	if cfg.Version != 1 {
		return nil, fmt.Errorf("unsupported keybindings version: %d", cfg.Version)
	}

	knownActions := make(map[string]bool)
	knownByScope := make(map[string]map[string]bool)
	for _, d := range defaults {
		knownActions[d.Action] = true
		if _, ok := knownByScope[d.Scope]; !ok {
			knownByScope[d.Scope] = make(map[string]bool)
		}
		knownByScope[d.Scope][d.Action] = true
	}

	profiles := make(map[string]map[string][]string)
	for rawName, rawActions := range cfg.Profiles {
		name := strings.TrimSpace(rawName)
		if name == "" {
			return nil, fmt.Errorf("keybindings profile: name is required")
		}
		actions := make(map[string][]string)
		for rawAction, rawKeys := range rawActions {
			action := strings.TrimSpace(rawAction)
			if !knownActions[action] {
				return nil, fmt.Errorf("keybindings profile=%q: unknown action %q", name, action)
			}
			keys := normalizeKeyList(rawKeys)
			if len(keys) == 0 {
				return nil, fmt.Errorf("keybindings profile=%q action=%q: keys are required", name, action)
			}
			actions[action] = keys
		}
		profiles[name] = actions
	}

	out := make([]keybindingConfig, 0)
	for rawScope, block := range cfg.Scopes {
		scope := strings.TrimSpace(rawScope)
		scopeActions, ok := knownByScope[scope]
		if !ok {
			return nil, fmt.Errorf("keybindings: unknown scope %q", scope)
		}

		merged := make(map[string][]string)
		for _, rawUse := range block.Use {
			use := strings.TrimSpace(rawUse)
			prof, ok := profiles[use]
			if !ok {
				return nil, fmt.Errorf("keybindings scope=%q: unknown profile %q", scope, use)
			}
			for action, keys := range prof {
				if scopeActions[action] {
					merged[action] = keys
				}
			}
		}
		for rawAction, rawKeys := range block.Bind {
			action := strings.TrimSpace(rawAction)
			if !knownActions[action] {
				return nil, fmt.Errorf("keybindings scope=%q: unknown action %q", scope, action)
			}
			if !scopeActions[action] {
				return nil, fmt.Errorf("keybindings scope=%q: action %q not supported in scope", scope, action)
			}
			keys := normalizeKeyList(rawKeys)
			if len(keys) == 0 {
				return nil, fmt.Errorf("keybindings scope=%q action=%q: keys are required", scope, action)
			}
			merged[action] = keys
		}

		for action, keys := range merged {
			out = append(out, keybindingConfig{Scope: scope, Action: action, Keys: keys})
		}
	}

	out = normalizeKeybindings(out)
	sort.Slice(out, func(i, j int) bool {
		if out[i].Scope != out[j].Scope {
			return out[i].Scope < out[j].Scope
		}
		return out[i].Action < out[j].Action
	})
	return out, nil
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

func normalizeShortcutOverrides(in []shortcutOverride) []shortcutOverride {
	out := make([]shortcutOverride, 0, len(in))
	for _, o := range in {
		keys := normalizeKeyList(o.Keys)
		out = append(out, shortcutOverride{
			Scope:  strings.TrimSpace(o.Scope),
			Action: strings.TrimSpace(o.Action),
			Keys:   keys,
		})
	}
	return out
}

func legacyOverridesToKeybindings(in []shortcutOverride) []keybindingConfig {
	out := make([]keybindingConfig, 0, len(in))
	for _, o := range in {
		out = append(out, keybindingConfig{Scope: o.Scope, Action: o.Action, Keys: o.Keys})
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

	if err := validateKeybindingConflicts(out); err != nil {
		return nil, false, err
	}
	return out, changed, nil
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
	return out
}

func saveAppSettings(s appSettings) error {
	primaryPath, err := configPath()
	if err != nil {
		return err
	}
	formats, _, loadErr := loadAppConfig()
	if loadErr != nil {
		return loadErr
	}
	cfg := configFile{
		Account:  formatsToAccountConfigs(formats),
		Settings: normalizeSettings(s),
	}
	return writeConfigFile(primaryPath, cfg)
}

func saveFormats(formats []csvFormat) error {
	primaryPath, err := configPath()
	if err != nil {
		return err
	}
	_, settings, loadErr := loadAppConfig()
	if loadErr != nil {
		return loadErr
	}
	cfg := configFile{
		Account:  formatsToAccountConfigs(formats),
		Settings: normalizeSettings(settings),
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

func renderKeybindingsTemplate(bindings []keybindingConfig) string {
	type profileEntry struct {
		name    string
		scopes  []string
		actions map[string][]string
	}

	var buf strings.Builder
	buf.WriteString("version = 1\n\n")
	buf.WriteString("# Full keybindings catalog.\n")
	buf.WriteString("# Shared bindings are declared once in profiles; scopes reference them via `use`.\n")
	buf.WriteString("# Scope-specific bindings live in each scope `bind` map.\n\n")

	scopeActions := make(map[string]map[string][]string)
	for _, b := range bindings {
		if _, ok := scopeActions[b.Scope]; !ok {
			scopeActions[b.Scope] = make(map[string][]string)
		}
		scopeActions[b.Scope][b.Action] = append([]string(nil), b.Keys...)
	}

	type groupKey struct {
		action string
		sig    string
	}
	groups := make(map[groupKey][]string)
	keysByGroup := make(map[groupKey][]string)
	for scope, actions := range scopeActions {
		for action, keys := range actions {
			sig := strings.Join(keys, "\x1f")
			k := groupKey{action: action, sig: sig}
			groups[k] = append(groups[k], scope)
			keysByGroup[k] = keys
		}
	}

	var sharedKeys []groupKey
	for k, scopes := range groups {
		if len(scopes) >= 2 {
			sharedKeys = append(sharedKeys, k)
		}
	}
	sort.Slice(sharedKeys, func(i, j int) bool {
		if sharedKeys[i].action != sharedKeys[j].action {
			return sharedKeys[i].action < sharedKeys[j].action
		}
		return sharedKeys[i].sig < sharedKeys[j].sig
	})

	profilesByScopeSig := make(map[string]*profileEntry)
	scopeSetOrder := make([]string, 0)
	for _, g := range sharedKeys {
		scopes := append([]string(nil), groups[g]...)
		sort.Strings(scopes)
		scopeSig := strings.Join(scopes, ",")
		p, ok := profilesByScopeSig[scopeSig]
		if !ok {
			p = &profileEntry{
				name:    "",
				scopes:  scopes,
				actions: make(map[string][]string),
			}
			profilesByScopeSig[scopeSig] = p
			scopeSetOrder = append(scopeSetOrder, scopeSig)
		}
		p.actions[g.action] = keysByGroup[g]
	}

	nameCounts := make(map[string]int)
	profiles := make([]profileEntry, 0, len(scopeSetOrder))
	for _, sig := range scopeSetOrder {
		p := profilesByScopeSig[sig]
		actionNames := make([]string, 0, len(p.actions))
		for action := range p.actions {
			actionNames = append(actionNames, action)
		}
		sort.Strings(actionNames)
		base := profileNameFromActions(actionNames)
		nameCounts[base]++
		if nameCounts[base] == 1 {
			p.name = base
		} else {
			p.name = fmt.Sprintf("%s_%d", base, nameCounts[base])
		}
		profiles = append(profiles, *p)
	}

	if len(profiles) > 0 {
		for _, p := range profiles {
			buf.WriteString(fmt.Sprintf("[profiles.%s]\n", p.name))
			actionNames := make([]string, 0, len(p.actions))
			for action := range p.actions {
				actionNames = append(actionNames, action)
			}
			sort.Strings(actionNames)
			for _, action := range actionNames {
				buf.WriteString(fmt.Sprintf("%s = %s\n", action, formatTomlStringArray(p.actions[action])))
			}
			buf.WriteString("\n")
		}
	}

	scopeUse := make(map[string][]string)
	scopeBound := make(map[string]map[string][]string)
	for scope, actions := range scopeActions {
		covered := make(map[string]bool)
		for _, p := range profiles {
			if !containsString(p.scopes, scope) {
				continue
			}
			matchedAny := false
			for action, keys := range p.actions {
				if equalStringSlices(actions[action], keys) {
					covered[action] = true
					matchedAny = true
				}
			}
			if matchedAny {
				scopeUse[scope] = append(scopeUse[scope], p.name)
			}
		}
		sort.Strings(scopeUse[scope])
		for action, keys := range actions {
			if covered[action] {
				continue
			}
			if _, ok := scopeBound[scope]; !ok {
				scopeBound[scope] = make(map[string][]string)
			}
			scopeBound[scope][action] = keys
		}
	}

	scopes := make([]string, 0, len(scopeActions))
	for scope := range scopeActions {
		scopes = append(scopes, scope)
	}
	sort.Strings(scopes)

	for _, scope := range scopes {
		buf.WriteString(fmt.Sprintf("[scopes.%s]\n", scope))
		if len(scopeUse[scope]) > 0 {
			buf.WriteString(fmt.Sprintf("use = %s\n", formatTomlStringArray(scopeUse[scope])))
		}

		actions := scopeBound[scope]
		if len(actions) > 0 {
			actionNames := make([]string, 0, len(actions))
			for action := range actions {
				actionNames = append(actionNames, action)
			}
			sort.Strings(actionNames)
			binds := make([]string, 0, len(actionNames))
			for _, action := range actionNames {
				binds = append(binds, fmt.Sprintf("%s = %s", action, formatTomlStringArray(actions[action])))
			}
			buf.WriteString("bind = { ")
			buf.WriteString(strings.Join(binds, ", "))
			buf.WriteString(" }\n")
		}
		buf.WriteString("\n")
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

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func profileNameFromActions(actions []string) string {
	if len(actions) == 0 {
		return "shared"
	}
	parts := make([]string, 0, min(3, len(actions)))
	for i, action := range actions {
		if i >= 3 {
			break
		}
		name := strings.ToLower(strings.TrimSpace(action))
		name = strings.ReplaceAll(name, "-", "_")
		name = strings.ReplaceAll(name, " ", "_")
		parts = append(parts, name)
	}
	if len(actions) > 3 {
		parts = append(parts, "etc")
	}
	return strings.Join(parts, "_")
}
