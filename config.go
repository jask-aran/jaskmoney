package main

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/BurntSushi/toml"
)

// ---------------------------------------------------------------------------
// CSV format configuration (TOML-based)
// ---------------------------------------------------------------------------

// csvFormat defines how to parse a bank CSV file.
type csvFormat struct {
	Name        string `toml:"name"`
	Description string `toml:"description"`
	DateFormat  string `toml:"date_format"`
	HasHeader   bool   `toml:"has_header"`
	Delimiter   string `toml:"delimiter"`
	DateCol     int    `toml:"date_col"`
	AmountCol   int    `toml:"amount_col"`
	DescCol     int    `toml:"desc_col"`     // starting column for description
	DescJoin    bool   `toml:"desc_join"`    // if true, join desc_col..end
	AmountStrip string `toml:"amount_strip"` // chars to strip from amount
}

// configFile is the top-level TOML structure.
type configFile struct {
	Format   []csvFormat `toml:"format"`
	Settings appSettings `toml:"settings"`
}

type appSettings struct {
	RowsPerPage      int    `toml:"rows_per_page"`
	SpendingWeekFrom string `toml:"spending_week_from"` // "sunday" or "monday"
	DashTimeframe    int    `toml:"dash_timeframe"`
	DashCustomStart  string `toml:"dash_custom_start"`
	DashCustomEnd    string `toml:"dash_custom_end"`
}

const defaultConfigTOML = `# Jaskmoney CSV Format Definitions
# Add new [[format]] blocks to support different bank exports.

[[format]]
name = "ANZ"
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

// configDir returns the directory for jaskmoney config files,
// using XDG_CONFIG_HOME or falling back to ~/.config.
func configDir() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("user config dir: %w", err)
	}
	return filepath.Join(dir, "jaskmoney"), nil
}

// configPath returns the full path to the formats.toml file.
func configPath() (string, error) {
	dir, err := configDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(dir, "formats.toml"), nil
}

// loadFormats loads CSV format definitions from the config file.
// If the file doesn't exist, it is created with the default ANZ format.
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

func loadAppConfig() ([]csvFormat, appSettings, error) {
	path, err := configPath()
	if err != nil {
		return defaultFormats(), defaultSettings(), err
	}

	// Create config file with defaults if missing
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if mkErr := os.MkdirAll(filepath.Dir(path), 0755); mkErr != nil {
			return defaultFormats(), defaultSettings(), fmt.Errorf("create config dir: %w", mkErr)
		}
		if wErr := os.WriteFile(path, []byte(defaultConfigTOML), 0644); wErr != nil {
			return defaultFormats(), defaultSettings(), fmt.Errorf("write default config: %w", wErr)
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return defaultFormats(), defaultSettings(), fmt.Errorf("read config: %w", err)
	}
	formats, settings, parseErr := parseConfig(data)
	if parseErr != nil {
		return defaultFormats(), defaultSettings(), parseErr
	}
	return formats, settings, nil
}

// parseFormats parses TOML bytes into format definitions.
func parseFormats(data []byte) ([]csvFormat, error) {
	formats, _, err := parseConfig(data)
	return formats, err
}

// parseConfig parses TOML bytes into full config content.
func parseConfig(data []byte) ([]csvFormat, appSettings, error) {
	var cfg configFile
	if err := toml.Unmarshal(data, &cfg); err != nil {
		return nil, defaultSettings(), fmt.Errorf("parse formats.toml: %w", err)
	}
	if len(cfg.Format) == 0 {
		return nil, defaultSettings(), fmt.Errorf("no formats defined in config")
	}
	// Validate
	for i, f := range cfg.Format {
		if f.Name == "" {
			return nil, defaultSettings(), fmt.Errorf("format[%d]: name is required", i)
		}
		if f.DateFormat == "" {
			return nil, defaultSettings(), fmt.Errorf("format[%d] %q: date_format is required", i, f.Name)
		}
	}
	settings := normalizeSettings(cfg.Settings)
	return cfg.Format, settings, nil
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
	path, err := configPath()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}
	cfg := configFile{
		Format:   defaultFormats(),
		Settings: normalizeSettings(s),
	}
	if data, readErr := os.ReadFile(path); readErr == nil {
		if formats, _, parseErr := parseConfig(data); parseErr == nil {
			cfg.Format = formats
		}
	}

	var buf bytes.Buffer
	if err := toml.NewEncoder(&buf).Encode(cfg); err != nil {
		return fmt.Errorf("encode formats.toml: %w", err)
	}
	if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
		return fmt.Errorf("write formats.toml: %w", err)
	}
	return nil
}

// defaultFormats returns the built-in ANZ format.
func defaultFormats() []csvFormat {
	return []csvFormat{
		{
			Name:        "ANZ",
			Description: "ANZ Australia bank export",
			DateFormat:  "2/01/2006",
			HasHeader:   false,
			Delimiter:   ",",
			DateCol:     0,
			AmountCol:   1,
			DescCol:     2,
			DescJoin:    true,
			AmountStrip: ",",
		},
	}
}

// findFormat looks up a format by name (case-insensitive).
func findFormat(formats []csvFormat, name string) *csvFormat {
	for i := range formats {
		if strings.EqualFold(formats[i].Name, name) {
			return &formats[i]
		}
	}
	return nil
}
