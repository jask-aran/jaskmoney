package db

import (
	"database/sql"
	"fmt"
	"math/rand"
	"time"
)

func SeedTestData(db *sql.DB) error {
	if err := seedAccounts(db); err != nil {
		return err
	}
	if err := seedCategories(db); err != nil {
		return err
	}
	if err := seedTags(db); err != nil {
		return err
	}
	if err := seedTransactions(db); err != nil {
		return err
	}
	return nil
}

func seedAccounts(db *sql.DB) error {
	items := []struct {
		name, typ, prefix string
	}{
		{"Everyday", "checking", "ANZ"},
		{"Rainy Day", "savings", "WBC"},
		{"Rewards Card", "credit", "AMEX"},
	}
	for _, a := range items {
		if _, err := db.Exec(`INSERT OR IGNORE INTO accounts(name, type, prefix, active) VALUES(?, ?, ?, 1)`, a.name, a.typ, a.prefix); err != nil {
			return err
		}
	}
	return nil
}

func seedCategories(db *sql.DB) error {
	cats := []struct {
		name, color string
	}{
		{"Groceries", "#89b4fa"}, {"Transport", "#f9e2af"}, {"Dining", "#fab387"}, {"Rent", "#f38ba8"},
		{"Utilities", "#a6e3a1"}, {"Health", "#94e2d5"}, {"Shopping", "#cba6f7"}, {"Travel", "#89dceb"},
		{"Entertainment", "#f2cdcd"}, {"Income", "#b4befe"},
	}
	for _, c := range cats {
		if _, err := db.Exec(`INSERT OR IGNORE INTO categories(name, color) VALUES(?, ?)`, c.name, c.color); err != nil {
			return err
		}
	}
	return nil
}

func seedTags(db *sql.DB) error {
	tags := []string{"urgent", "recurring", "work", "personal", "tax-deductible"}
	for _, t := range tags {
		if _, err := db.Exec(`INSERT OR IGNORE INTO tags(name, scope_id) VALUES(?, NULL)`, t); err != nil {
			return err
		}
	}
	return nil
}

func seedTransactions(db *sql.DB) error {
	var count int
	if err := db.QueryRow(`SELECT COUNT(*) FROM transactions`).Scan(&count); err != nil {
		return err
	}
	if count >= 100 {
		return nil
	}

	rng := rand.New(rand.NewSource(7))
	now := time.Now()
	desc := []string{"Grocery run", "Ride share", "Paycheck", "Coffee", "Streaming", "Fuel", "Gym", "Pharmacy", "Bookstore", "Electric bill"}
	for i := 0; i < 100; i++ {
		accountID := (i % 3) + 1
		categoryID := (i % 10) + 1
		day := now.AddDate(0, 0, -rng.Intn(90)).Format("2006-01-02")
		amount := float64((rng.Intn(50000) - 45000)) / 100
		if i%11 == 0 {
			amount = float64(150000+rng.Intn(80000)) / 100
			categoryID = 10
		}
		note := fmt.Sprintf("seed-%03d", i+1)
		if _, err := db.Exec(`INSERT INTO transactions(account_id, date_iso, amount, description, category_id, notes) VALUES(?, ?, ?, ?, ?, ?)`,
			accountID, day, amount, desc[rng.Intn(len(desc))], categoryID, note,
		); err != nil {
			return err
		}
	}
	return nil
}
