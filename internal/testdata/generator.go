package testdata

import (
    "context"
    "math/rand"
    "time"

    "github.com/google/uuid"

    "github.com/jask/jaskmoney/internal/database/repository"
)

// Repos bundles repos used by Seed.
type Repos struct {
    Accounts     *repository.AccountRepo
    Categories   *repository.CategoryRepo
    Transactions *repository.TransactionRepo
}

// Seed creates sample data and default categories.
func Seed(ctx context.Context, repos Repos) error {
    rand.Seed(time.Now().UnixNano())

    acct := repository.Account{ID: uuid.NewString(), Name: "Sample Checking", Institution: "Sample Bank", AccountType: "checking"}
    if err := repos.Accounts.Upsert(ctx, acct); err != nil {
        return err
    }

    if err := seedCategories(ctx, repos.Categories); err != nil {
        return err
    }

    now := time.Now().UTC()
    for i := 0; i < 20; i++ {
        amount := int64((rand.Intn(20000) + 500))
        desc := []string{"UBER EATS* SUSHI", "AMAZON.COM*XYZ", "WOOLWORTHS", "SPOTIFY", "SALARY ACME"}[rand.Intn(5)]
        status := "posted"
        if rand.Intn(10) < 2 {
            status = "pending"
        }
        tx := repository.Transaction{
            ID:             uuid.NewString(),
            AccountID:      acct.ID,
            Date:           now.AddDate(0, 0, -rand.Intn(10)),
            AmountCents:    -amount,
            RawDescription: desc,
            Status:         status,
        }
        _ = repos.Transactions.Insert(ctx, tx)
    }
    return nil
}

func seedCategories(ctx context.Context, repo *repository.CategoryRepo) error {
    type cat struct {
        Name      string
        Parent    string
        SortOrder int
    }
    cats := []cat{
        {Name: "Shopping", SortOrder: 1},
        {Name: "Shopping > Clothing", Parent: "Shopping", SortOrder: 2},
        {Name: "Shopping > Electronics", Parent: "Shopping", SortOrder: 3},
        {Name: "Shopping > Home & Garden", Parent: "Shopping", SortOrder: 4},
        {Name: "Shopping > General", Parent: "Shopping", SortOrder: 5},
        {Name: "Food", SortOrder: 10},
        {Name: "Food > Groceries", Parent: "Food", SortOrder: 11},
        {Name: "Food > Restaurants", Parent: "Food", SortOrder: 12},
        {Name: "Food > Coffee & Drinks", Parent: "Food", SortOrder: 13},
        {Name: "Food > Takeaway", Parent: "Food", SortOrder: 14},
        {Name: "Fixed Costs", SortOrder: 20},
        {Name: "Fixed Costs > Rent / Mortgage", Parent: "Fixed Costs", SortOrder: 21},
        {Name: "Fixed Costs > Utilities", Parent: "Fixed Costs", SortOrder: 22},
        {Name: "Fixed Costs > Insurance", Parent: "Fixed Costs", SortOrder: 23},
        {Name: "Fixed Costs > Subscriptions", Parent: "Fixed Costs", SortOrder: 24},
        {Name: "Fixed Costs > Phone & Internet", Parent: "Fixed Costs", SortOrder: 25},
        {Name: "Investments & Savings", SortOrder: 30},
        {Name: "Investments & Savings > Savings Transfer", Parent: "Investments & Savings", SortOrder: 31},
        {Name: "Investments & Savings > Investment Deposit", Parent: "Investments & Savings", SortOrder: 32},
        {Name: "Investments & Savings > Retirement", Parent: "Investments & Savings", SortOrder: 33},
        {Name: "Misc", SortOrder: 40},
        {Name: "Misc > Transport", Parent: "Misc", SortOrder: 41},
        {Name: "Misc > Health", Parent: "Misc", SortOrder: 42},
        {Name: "Misc > Entertainment", Parent: "Misc", SortOrder: 43},
        {Name: "Misc > Gifts", Parent: "Misc", SortOrder: 44},
        {Name: "Misc > Fees & Charges", Parent: "Misc", SortOrder: 45},
        {Name: "Misc > Uncategorized", Parent: "Misc", SortOrder: 99},
    }

    parents := map[string]string{}
    for _, c := range cats {
        id := uuid.NewString()
        var parentID *string
        if c.Parent != "" {
            pid, ok := parents[c.Parent]
            if !ok {
                pid = uuid.NewString()
                parents[c.Parent] = pid
                _ = repo.Upsert(ctx, repository.Category{ID: pid, Name: c.Parent, SortOrder: c.SortOrder})
            }
            parentID = &pid
        }
        if err := repo.Upsert(ctx, repository.Category{ID: id, ParentID: parentID, Name: c.Name, SortOrder: c.SortOrder}); err != nil {
            return err
        }
        parents[c.Name] = id
    }
    return nil
}
