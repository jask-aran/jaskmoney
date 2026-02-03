package service

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/jask/jaskmoney/internal/database/repository"
)

// IngestService handles CSV imports for MVP format.
type IngestService struct {
	Transactions *repository.TransactionRepo
	Accounts     *repository.AccountRepo
}

type IngestResult struct {
	Imported int
	Skipped  int
	Errors   []error
}

// CSV columns: date, posted_date, description, amount, external_id, account
// amount is dollars (string with optional minus), converted to cents.
func (s *IngestService) ImportCSV(ctx context.Context, r io.Reader, tz *time.Location) (IngestResult, error) {
	res := IngestResult{}
	csvr := csv.NewReader(bufio.NewReader(r))
	csvr.TrimLeadingSpace = true
	line := 0
	for {
		line++
		rec, err := csvr.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			res.Errors = append(res.Errors, fmt.Errorf("line %d: %w", line, err))
			continue
		}
		if len(rec) < 6 {
			res.Errors = append(res.Errors, fmt.Errorf("line %d: expected 6 columns", line))
			continue
		}
		dateStr, postedStr, desc, amountStr, externalID, accountName := rec[0], rec[1], rec[2], rec[3], rec[4], rec[5]
		date, err := parseLocalDate(dateStr, tz)
		if err != nil {
			res.Errors = append(res.Errors, fmt.Errorf("line %d date: %w", line, err))
			continue
		}
		var posted *time.Time
		if strings.TrimSpace(postedStr) != "" {
			p, err := parseLocalDate(postedStr, tz)
			if err != nil {
				res.Errors = append(res.Errors, fmt.Errorf("line %d posted_date: %w", line, err))
				continue
			}
			posted = &p
		}
		amountCents, err := dollarsToCents(amountStr)
		if err != nil {
			res.Errors = append(res.Errors, fmt.Errorf("line %d amount: %w", line, err))
			continue
		}

		acctID := uuid.NewString()
		acct := repository.Account{ID: acctID, Name: accountName, Institution: accountName, AccountType: "checking"}
		if err := s.Accounts.Upsert(ctx, acct); err != nil {
			res.Errors = append(res.Errors, fmt.Errorf("line %d account: %w", line, err))
			continue
		}

		t := repository.Transaction{
			ID:             uuid.NewString(),
			AccountID:      acct.ID,
			ExternalID:     nullableStr(externalID),
			Date:           date,
			PostedDate:     posted,
			AmountCents:    amountCents,
			RawDescription: desc,
			Status:         chooseStatus(posted),
			SourceHash:     hashSource(accountName, dateStr, amountStr, desc),
		}
		if err := s.Transactions.Insert(ctx, t); err != nil {
			// skip duplicates on unique constraint
			if strings.Contains(err.Error(), "UNIQUE") {
				res.Skipped++
				continue
			}
			res.Errors = append(res.Errors, fmt.Errorf("line %d insert: %w", line, err))
			continue
		}
		res.Imported++
	}
	return res, nil
}

func parseLocalDate(s string, loc *time.Location) (time.Time, error) {
	layout := "2006-01-02"
	t, err := time.ParseInLocation(layout, s, loc)
	if err != nil {
		return time.Time{}, err
	}
	return t.UTC(), nil
}

func dollarsToCents(s string) (int64, error) {
	s = strings.ReplaceAll(strings.TrimSpace(s), ",", "")
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, err
	}
	return int64(f * 100), nil
}

func nullableStr(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

func chooseStatus(posted *time.Time) string {
	if posted == nil {
		return "pending"
	}
	return "posted"
}

func hashSource(parts ...string) *string {
	joined := strings.Join(parts, "|")
	sum := sha256.Sum256([]byte(joined))
	h := fmt.Sprintf("%x", sum[:])
	return &h
}
