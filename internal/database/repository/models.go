package repository

import "time"

// Account represents an account row.
type Account struct {
	ID          string
	Name        string
	Institution string
	AccountType string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// Category represents a category row.
type Category struct {
	ID        string
	ParentID  *string
	Name      string
	Icon      *string
	SortOrder int
}

// Tag represents a tag row.
type Tag struct {
	ID   string
	Name string
}

// Transaction represents a transaction row.
type Transaction struct {
	ID             string
	AccountID      string
	ExternalID     *string
	Date           time.Time
	PostedDate     *time.Time
	AmountCents    int64
	RawDescription string
	MerchantName   *string
	CategoryID     *string
	Comment        *string
	Status         string
	SourceHash     *string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	Tags           []Tag
}

// MerchantRule represents a rule.
type MerchantRule struct {
	ID          string
	Pattern     string
	PatternType string
	CategoryID  string
	Confidence  float64
	Source      string
	CreatedAt   time.Time
}

// PendingReconciliation represents potential duplicate.
type PendingReconciliation struct {
	ID             string
	TransactionAID string
	TransactionBID string
	Similarity     float64
	LLMConfidence  *float64
	LLMReasoning   *string
	Status         string
	CreatedAt      time.Time
}
