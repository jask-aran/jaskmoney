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
	v.SetDefault("llm.model", "gemini-2.5-flash-preview-05-20")
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
