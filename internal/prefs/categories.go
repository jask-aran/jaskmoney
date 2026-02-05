package prefs

import (
	"encoding/json"
	"os"
	"path/filepath"

	"github.com/jask/jaskmoney/internal/database/repository"
)

const categoriesFile = "categories.json"

func categoriesPath() (string, error) {
	dir, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	dir = filepath.Join(dir, "jaskmoney")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	return filepath.Join(dir, categoriesFile), nil
}

func SaveCategories(cats []repository.Category) error {
	path, err := categoriesPath()
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(cats, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func LoadCategories() ([]repository.Category, error) {
	path, err := categoriesPath()
	if err != nil {
		return nil, err
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var cats []repository.Category
	if err := json.Unmarshal(data, &cats); err != nil {
		return nil, err
	}
	return cats, nil
}
