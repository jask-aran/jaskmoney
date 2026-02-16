package db

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

const defaultAccountsTOML = `version = 1

[account]
`

type LoadConfigDefaults struct {
	AppJumpKey          string
	KeybindingsByAction map[string][]string
}

type AppSection struct {
	JumpKey string `toml:"jump_key"`
}

type AppConfigFile struct {
	Version int        `toml:"version"`
	App     AppSection `toml:"app"`
}

type AccountConfig struct {
	Name         string `toml:"name"`
	Type         string `toml:"type"`
	Active       *bool  `toml:"active"`
	ImportPrefix string `toml:"import_prefix"`
	DateFormat   string `toml:"date_format"`
	HasHeader    bool   `toml:"has_header"`
	Delimiter    string `toml:"delimiter"`
	DateCol      int    `toml:"date_col"`
	AmountCol    int    `toml:"amount_col"`
	DescCol      int    `toml:"desc_col"`
	DescJoin     bool   `toml:"desc_join"`
	AmountStrip  string `toml:"amount_strip"`
}

type AccountsConfigFile struct {
	Version int                      `toml:"version"`
	Account map[string]AccountConfig `toml:"account"`
}

type KeybindingsConfigFile struct {
	Version  int                 `toml:"version"`
	Bindings map[string][]string `toml:"bindings"`
}

type ConfigBundle struct {
	ConfigDir   string
	Config      AppConfigFile
	Accounts    AccountsConfigFile
	Keybindings KeybindingsConfigFile
}

func LoadConfigBundle(rootDir string, defaults LoadConfigDefaults) (ConfigBundle, error) {
	if strings.TrimSpace(rootDir) == "" {
		rootDir = "."
	}
	if strings.TrimSpace(defaults.AppJumpKey) == "" {
		defaults.AppJumpKey = "v"
	}
	defaults.KeybindingsByAction = normalizeActionKeyMap(defaults.KeybindingsByAction)

	cfgDir := filepath.Join(rootDir, "config")
	if err := os.MkdirAll(cfgDir, 0o755); err != nil {
		return ConfigBundle{}, fmt.Errorf("create config dir: %w", err)
	}

	configPath := filepath.Join(cfgDir, "config.toml")
	accountsPath := filepath.Join(cfgDir, "accounts.toml")
	keybindingsPath := filepath.Join(cfgDir, "keybindings.toml")

	if err := ensureConfigFile(configPath, renderDefaultConfigTOML(defaults.AppJumpKey)); err != nil {
		return ConfigBundle{}, err
	}
	if err := ensureConfigFile(accountsPath, defaultAccountsTOML); err != nil {
		return ConfigBundle{}, err
	}
	if err := ensureConfigFile(keybindingsPath, renderKeybindingsTOML(defaults.KeybindingsByAction)); err != nil {
		return ConfigBundle{}, err
	}

	var config AppConfigFile
	if _, err := toml.DecodeFile(configPath, &config); err != nil {
		return ConfigBundle{}, fmt.Errorf("parse %s: %w", configPath, err)
	}
	if err := validateAppConfig(&config, defaults.AppJumpKey); err != nil {
		return ConfigBundle{}, fmt.Errorf("validate %s: %w", configPath, err)
	}

	var accounts AccountsConfigFile
	if _, err := toml.DecodeFile(accountsPath, &accounts); err != nil {
		return ConfigBundle{}, fmt.Errorf("parse %s: %w", accountsPath, err)
	}
	if err := validateAccountsConfig(&accounts); err != nil {
		return ConfigBundle{}, fmt.Errorf("validate %s: %w", accountsPath, err)
	}

	var keybindings KeybindingsConfigFile
	if _, err := toml.DecodeFile(keybindingsPath, &keybindings); err != nil {
		return ConfigBundle{}, fmt.Errorf("parse %s: %w", keybindingsPath, err)
	}
	changed, err := validateAndMergeKeybindingsConfig(&keybindings, defaults.KeybindingsByAction)
	if err != nil {
		return ConfigBundle{}, fmt.Errorf("validate %s: %w", keybindingsPath, err)
	}
	if changed {
		if err := os.WriteFile(keybindingsPath, []byte(renderKeybindingsTOML(keybindings.Bindings)), 0o644); err != nil {
			return ConfigBundle{}, fmt.Errorf("write %s: %w", keybindingsPath, err)
		}
	}

	return ConfigBundle{
		ConfigDir:   cfgDir,
		Config:      config,
		Accounts:    accounts,
		Keybindings: keybindings,
	}, nil
}

func renderDefaultConfigTOML(jumpKey string) string {
	jumpKey = strings.ToLower(strings.TrimSpace(jumpKey))
	if jumpKey == "" {
		jumpKey = "v"
	}
	return "version = 1\n\n[app]\njump_key = " + fmt.Sprintf("%q", jumpKey) + "\n"
}

func renderKeybindingsTOML(bindings map[string][]string) string {
	keys := make([]string, 0, len(bindings))
	for action := range bindings {
		keys = append(keys, action)
	}
	sort.Strings(keys)

	var b bytes.Buffer
	b.WriteString("version = 1\n\n[bindings]\n")
	for _, action := range keys {
		b.WriteString(action)
		b.WriteString(" = ")
		b.WriteString(formatTOMLArray(bindings[action]))
		b.WriteByte('\n')
	}
	return b.String()
}

func formatTOMLArray(values []string) string {
	if len(values) == 0 {
		return "[]"
	}
	parts := make([]string, 0, len(values))
	for _, value := range values {
		parts = append(parts, fmt.Sprintf("%q", value))
	}
	return "[" + strings.Join(parts, ", ") + "]"
}

func ensureConfigFile(path, defaults string) error {
	_, err := os.Stat(path)
	if err == nil {
		return nil
	}
	if !os.IsNotExist(err) {
		return fmt.Errorf("stat %s: %w", path, err)
	}
	if err := os.WriteFile(path, []byte(defaults), 0o644); err != nil {
		return fmt.Errorf("write %s: %w", path, err)
	}
	return nil
}

func validateAppConfig(cfg *AppConfigFile, defaultJumpKey string) error {
	if cfg.Version == 0 {
		cfg.Version = 1
	}
	if cfg.Version != 1 {
		return fmt.Errorf("unsupported version %d", cfg.Version)
	}
	key := strings.TrimSpace(cfg.App.JumpKey)
	if key == "" {
		key = defaultJumpKey
	}
	if !isSingleGlyphKey(key) {
		return fmt.Errorf("app.jump_key must be one letter or digit")
	}
	cfg.App.JumpKey = strings.ToLower(key)
	return nil
}

func validateAccountsConfig(cfg *AccountsConfigFile) error {
	if cfg.Version == 0 {
		cfg.Version = 1
	}
	if cfg.Version != 1 {
		return fmt.Errorf("unsupported version %d", cfg.Version)
	}
	if cfg.Account == nil {
		cfg.Account = map[string]AccountConfig{}
	}
	for key, acct := range cfg.Account {
		name := strings.TrimSpace(key)
		if name == "" {
			return fmt.Errorf("account key is required")
		}
		if strings.TrimSpace(acct.Name) != "" {
			acct.Name = strings.TrimSpace(acct.Name)
		} else {
			acct.Name = name
		}
		acct.Type = strings.ToLower(strings.TrimSpace(acct.Type))
		if acct.Type == "" {
			acct.Type = "debit"
		}
		if acct.Type != "debit" && acct.Type != "credit" {
			return fmt.Errorf("account %q: type must be debit or credit", name)
		}
		acct.ImportPrefix = strings.ToLower(strings.TrimSpace(acct.ImportPrefix))
		if acct.ImportPrefix == "" {
			acct.ImportPrefix = strings.ToLower(name)
		}
		acct.DateFormat = strings.TrimSpace(acct.DateFormat)
		if acct.DateFormat == "" {
			acct.DateFormat = "2/01/2006"
		}
		if strings.TrimSpace(acct.Delimiter) == "" {
			acct.Delimiter = ","
		}
		if len([]rune(acct.Delimiter)) != 1 {
			return fmt.Errorf("account %q: delimiter must be a single character", name)
		}
		if acct.DateCol < 0 || acct.AmountCol < 0 || acct.DescCol < 0 {
			return fmt.Errorf("account %q: date_col, amount_col, desc_col must be >= 0", name)
		}
		cfg.Account[name] = acct
	}
	return nil
}

func validateAndMergeKeybindingsConfig(cfg *KeybindingsConfigFile, defaults map[string][]string) (bool, error) {
	if cfg.Version == 0 {
		cfg.Version = 1
	}
	if cfg.Version != 1 {
		return false, fmt.Errorf("unsupported version %d", cfg.Version)
	}
	if cfg.Bindings == nil {
		cfg.Bindings = map[string][]string{}
	}

	merged := cloneActionMap(defaults)
	for action, keys := range cfg.Bindings {
		a := strings.TrimSpace(action)
		if !isValidActionID(a) {
			return false, fmt.Errorf("invalid action %q", action)
		}
		if _, exists := defaults[a]; !exists {
			return false, fmt.Errorf("unknown action %q", a)
		}
		if len(keys) == 0 {
			return false, fmt.Errorf("action %q: keys are required", a)
		}
		out := make([]string, 0, len(keys))
		for _, key := range keys {
			k := strings.ToLower(strings.TrimSpace(key))
			if k == "" {
				return false, fmt.Errorf("action %q: key cannot be empty", a)
			}
			out = append(out, k)
		}
		merged[a] = out
	}

	changed := !equalActionMaps(cfg.Bindings, merged)
	cfg.Bindings = merged
	return changed, nil
}

func normalizeActionKeyMap(in map[string][]string) map[string][]string {
	out := make(map[string][]string, len(in))
	for action, keys := range in {
		a := strings.TrimSpace(action)
		if !isValidActionID(a) {
			continue
		}
		normalizedKeys := make([]string, 0, len(keys))
		for _, key := range keys {
			k := strings.ToLower(strings.TrimSpace(key))
			if k == "" {
				continue
			}
			normalizedKeys = append(normalizedKeys, k)
		}
		if len(normalizedKeys) == 0 {
			continue
		}
		out[a] = normalizedKeys
	}
	return out
}

func cloneActionMap(in map[string][]string) map[string][]string {
	out := make(map[string][]string, len(in))
	for action, keys := range in {
		out[action] = append([]string(nil), keys...)
	}
	return out
}

func equalActionMaps(a, b map[string][]string) bool {
	if len(a) != len(b) {
		return false
	}
	for action, keysA := range a {
		keysB, ok := b[action]
		if !ok || len(keysA) != len(keysB) {
			return false
		}
		for i := range keysA {
			if keysA[i] != keysB[i] {
				return false
			}
		}
	}
	return true
}

func isSingleGlyphKey(key string) bool {
	r := []rune(strings.TrimSpace(key))
	if len(r) != 1 {
		return false
	}
	return unicode.IsLetter(r[0]) || unicode.IsDigit(r[0])
}

func isValidActionID(action string) bool {
	if action == "" {
		return false
	}
	for i, ch := range action {
		if unicode.IsLetter(ch) || unicode.IsDigit(ch) {
			continue
		}
		if ch == '-' && i > 0 && i < len(action)-1 {
			continue
		}
		return false
	}
	return true
}
