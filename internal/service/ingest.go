package service

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"math"
	"path/filepath"
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

	accountCache map[string]repository.Account
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
	csvr.FieldsPerRecord = -1
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
		if len(rec) < 6 { // date, posted_date, description, amount, external_id, account
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

		acct, err := s.accountForName(ctx, accountName)
		if err != nil {
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
			Status:         chooseStatus(posted, ""),
			SourceHash:     hashSource(acct.ID, date.Format(time.DateOnly), fmt.Sprintf("%d", amountCents), desc),
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

// ImportANZSimple ingests ANZ export with no headers: date, amount, description.
func (s *IngestService) ImportANZSimple(ctx context.Context, r io.Reader, accountName string, tz *time.Location) (IngestResult, error) {
	if tz == nil {
		tz = time.Local
	}
	if strings.TrimSpace(accountName) == "" {
		accountName = "ANZ"
	}
	res := IngestResult{}
	csvr := csv.NewReader(bufio.NewReader(r))
	csvr.TrimLeadingSpace = true
	csvr.FieldsPerRecord = -1

	acct, err := s.accountForName(ctx, accountName)
	if err != nil {
		return res, err
	}

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
		if len(rec) < 3 {
			res.Errors = append(res.Errors, fmt.Errorf("line %d: expected 3 columns (date, amount, description)", line))
			continue
		}
		date, err := parseANZDate(rec[0], tz)
		if err != nil {
			res.Errors = append(res.Errors, fmt.Errorf("line %d date: %w", line, err))
			continue
		}
		amountCents, err := dollarsToCents(rec[1])
		if err != nil {
			res.Errors = append(res.Errors, fmt.Errorf("line %d amount: %w", line, err))
			continue
		}
		desc := strings.TrimSpace(rec[2])
		posted := date
		t := repository.Transaction{
			ID:             uuid.NewString(),
			AccountID:      acct.ID,
			Date:           date,
			PostedDate:     &posted,
			AmountCents:    amountCents,
			RawDescription: desc,
			Status:         "posted",
			SourceHash:     hashSource(acct.ID, date.Format(time.DateOnly), fmt.Sprintf("%d", amountCents), desc),
		}
		if err := s.Transactions.Insert(ctx, t); err != nil {
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

func dollarsToCents(s string) (int64, error) {
	s = strings.ReplaceAll(strings.TrimSpace(s), ",", "")
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, err
	}
	return int64(math.Round(f * 100)), nil
}

func nullableStr(s string) *string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return &s
}

func chooseStatus(posted *time.Time, override string) string {
	if override != "" {
		return override
	}
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

func parseLocalDate(s string, loc *time.Location) (time.Time, error) {
	layout := "2006-01-02"
	if loc == nil {
		loc = time.Local
	}
	t, err := time.ParseInLocation(layout, strings.TrimSpace(s), loc)
	if err != nil {
		return time.Time{}, err
	}
	return t.UTC(), nil
}

func parseANZDate(s string, loc *time.Location) (time.Time, error) {
	if loc == nil {
		loc = time.Local
	}
	layout := "2/01/2006" // day/month/year (supports single-digit day)
	t, err := time.ParseInLocation(layout, strings.TrimSpace(s), loc)
	if err != nil {
		return time.Time{}, err
	}
	return t.UTC(), nil
}

func (s *IngestService) accountForName(ctx context.Context, name string) (repository.Account, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return repository.Account{}, errors.New("account name required")
	}
	if s.accountCache == nil {
		s.accountCache = make(map[string]repository.Account)
	}
	if acct, ok := s.accountCache[name]; ok {
		return acct, nil
	}
	id := deterministicAccountID(name)
	acct := repository.Account{ID: id, Name: name, Institution: name, AccountType: "checking"}
	if err := s.Accounts.Upsert(ctx, acct); err != nil {
		return repository.Account{}, err
	}
	s.accountCache[name] = acct
	return acct, nil
}

func deterministicAccountID(name string) string {
	key := strings.ToLower(strings.TrimSpace(filepath.Base(name)))
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte(key)).String()
}
