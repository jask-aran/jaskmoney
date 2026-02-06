package main

import (
	"fmt"
	"os"
	"path/filepath"

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
	Format []csvFormat `toml:"format"`
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

[[format]]
name = "CBA"
description = "Commonwealth Bank Australia"
date_format = "02/01/2006"
has_header = true
delimiter = ","
date_col = 0
amount_col = 1
desc_col = 2
desc_join = false
amount_strip = ","
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
	path, err := configPath()
	if err != nil {
		return defaultFormats(), nil
	}

	// Create config file with defaults if missing
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if mkErr := os.MkdirAll(filepath.Dir(path), 0755); mkErr != nil {
			return defaultFormats(), nil
		}
		if wErr := os.WriteFile(path, []byte(defaultConfigTOML), 0644); wErr != nil {
			return defaultFormats(), nil
		}
	}

	data, err := os.ReadFile(path)
	if err != nil {
		return defaultFormats(), nil
	}

	return parseFormats(data)
}

// parseFormats parses TOML bytes into format definitions.
func parseFormats(data []byte) ([]csvFormat, error) {
	var cfg configFile
	if err := toml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("parse formats.toml: %w", err)
	}
	if len(cfg.Format) == 0 {
		return nil, fmt.Errorf("no formats defined in config")
	}
	// Validate
	for i, f := range cfg.Format {
		if f.Name == "" {
			return nil, fmt.Errorf("format[%d]: name is required", i)
		}
		if f.DateFormat == "" {
			return nil, fmt.Errorf("format[%d] %q: date_format is required", i, f.Name)
		}
	}
	return cfg.Format, nil
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
		if formats[i].Name == name {
			return &formats[i]
		}
	}
	return nil
}
