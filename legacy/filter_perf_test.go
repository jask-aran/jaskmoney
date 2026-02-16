//go:build flowheavy

package main

import (
	"sort"
	"testing"
	"time"
)

func TestFilterParseApplyPerformance10kP95(t *testing.T) {
	rows := make([]transaction, 10_000)
	for i := 0; i < len(rows); i++ {
		amount := float64((i%500)-250) + 0.25
		cat := "Misc"
		desc := "payment"
		if i%3 == 0 {
			cat = "Groceries"
			desc = "coffee shop"
		}
		if i%5 == 0 {
			desc = "uber ride"
		}
		rows[i] = transaction{
			id:           i + 1,
			dateISO:      "2026-02-01",
			amount:       amount,
			description:  desc,
			categoryName: cat,
			accountName:  "ANZ",
		}
	}

	query := `(cat:Groceries OR desc:uber) AND type:debit AND amt:<-10`
	runs := 60
	durations := make([]time.Duration, 0, runs)

	for i := 0; i < runs; i++ {
		start := time.Now()
		node, err := parseFilter(query)
		if err != nil {
			t.Fatalf("parseFilter: %v", err)
		}
		_ = filteredRows(rows, node, nil, sortByDate, false)
		durations = append(durations, time.Since(start))
	}

	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	p95 := durations[int(float64(len(durations)-1)*0.95)]
	if p95 > 100*time.Millisecond {
		t.Fatalf("parse+apply p95=%s exceeds 100ms target", p95)
	}
}
