package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/viper"
)

// Config holds application configuration.
type Config struct {
	Database DatabaseConfig
	LLM      LLMConfig
	UI       UIConfig
}

// DatabaseConfig holds sqlite settings.
type DatabaseConfig struct {
	Path string
}

// LLMConfig holds provider settings.
type LLMConfig struct {
	Provider  string
	APIKeyEnv string
	APIKey    string
	Model     string
}

// UIConfig holds presentation settings.
type UIConfig struct {
	DateFormat     string
	CurrencySymbol string
	Timezone       string
}

// Load reads configuration from file and env. Env var overrides use prefix JASKMONEY_.
func Load() (Config, error) {
	v := viper.New()

	// default values
	v.SetDefault("database.path", filepath.Join(os.Getenv("HOME"), ".local", "share", "jaskmoney", "jaskmoney.db"))
	v.SetDefault("llm.provider", "gemini")
	v.SetDefault("llm.api_key_env", "GEMINI_API_KEY")
	v.SetDefault("llm.api_key", "")
	v.SetDefault("llm.model", "gemini-3-flash-preview")
	v.SetDefault("ui.date_format", "02/01")
	v.SetDefault("ui.currency_symbol", "$")
	v.SetDefault("ui.timezone", "Australia/Melbourne")

	v.SetConfigType("toml")

	cfgPath := os.Getenv("JASKMONEY_CONFIG")
	if cfgPath != "" {
		v.SetConfigFile(cfgPath)
	} else {
		v.AddConfigPath(filepath.Join(os.Getenv("HOME"), ".config", "jaskmoney"))
		v.SetConfigName("config")
	}

	v.SetEnvPrefix("JASKMONEY")
	v.AutomaticEnv()
	v.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))

	// read config file if present
	_ = v.ReadInConfig()

	var c Config
	if err := v.Unmarshal(&c); err != nil {
		return Config{}, fmt.Errorf("unmarshal config: %w", err)
	}
	return c, nil
}

// Save writes the provided config to disk, creating the config directory if needed.
// This is primarily used by the TUI settings view for non-sensitive preferences.
// The API key is stored in plain text in the config file; encourage users to prefer env vars.
func Save(cfg Config) error {
	path := os.Getenv("JASKMONEY_CONFIG")
	if path == "" {
		path = filepath.Join(os.Getenv("HOME"), ".config", "jaskmoney", "config.toml")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("mkdir config dir: %w", err)
	}

	v := viper.New()
	v.SetConfigType("toml")
	v.Set("database.path", cfg.Database.Path)
	v.Set("llm.provider", cfg.LLM.Provider)
	v.Set("llm.api_key_env", cfg.LLM.APIKeyEnv)
	v.Set("llm.api_key", cfg.LLM.APIKey)
	v.Set("llm.model", cfg.LLM.Model)
	v.Set("ui.date_format", cfg.UI.DateFormat)
	v.Set("ui.currency_symbol", cfg.UI.CurrencySymbol)
	v.Set("ui.timezone", cfg.UI.Timezone)

	if err := v.WriteConfigAs(path); err != nil {
		return fmt.Errorf("write config: %w", err)
	}
	return nil
}
