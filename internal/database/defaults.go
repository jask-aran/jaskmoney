package database

import (
	"context"
	"database/sql"
	"strings"

	"github.com/google/uuid"

	"github.com/jask/jaskmoney/internal/database/repository"
)

// SeedDefaults ensures baseline categories exist for new databases.
// It is idempotent and safe to run on every startup.
func SeedDefaults(ctx context.Context, db *sql.DB) error {
	catRepo := repository.NewCategoryRepo(db)
	existing, err := catRepo.List(ctx)
	if err == nil && len(existing) > 0 {
		return nil
	}
	defaults := []string{
		"Income",
		"Food > Groceries",
		"Food > Restaurants",
		"Transport",
		"Shopping",
		"Utilities",
		"Subscriptions",
		"Savings",
		"Health",
		"Entertainment",
	}
	for idx, path := range defaults {
		parts := strings.Split(path, ">")
		var parentID *string
		for _, raw := range parts {
			name := strings.TrimSpace(raw)
			id := uuid.NewSHA1(uuid.NameSpaceOID, []byte("cat:"+name)).String()
			cat := repository.Category{ID: id, Name: name, ParentID: parentID, SortOrder: idx}
			if err := catRepo.Upsert(ctx, cat); err != nil {
				return err
			}
			parentID = &id
		}
	}
	return nil
}
