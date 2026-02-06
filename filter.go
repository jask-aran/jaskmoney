package main

import (
	"sort"
	"strings"
	"time"
)

func dateRangeName(r int) string {
	switch r {
	case dateRangeAll:
		return "all time"
	case dateRangeThisMonth:
		return "this month"
	case dateRangeLastMonth:
		return "last month"
	case dateRange3Months:
		return "last 3 months"
	case dateRange6Months:
		return "last 6 months"
	}
	return "all time"
}

// getFilteredRows returns the current filtered/sorted view of transactions.
func (m model) getFilteredRows() []transaction {
	return filteredRows(m.rows, m.searchQuery, m.filterCategories, m.filterDateRange, m.sortColumn, m.sortAscending)
}

// filteredRows returns the subset of m.rows matching all active filters,
// sorted by the current sort column/direction.
func filteredRows(rows []transaction, searchQuery string, filterCats map[int]bool, dateRange int, sortCol int, sortAsc bool) []transaction {
	var out []transaction
	for _, r := range rows {
		if !matchesSearch(r, searchQuery) {
			continue
		}
		if !matchesCategoryFilter(r, filterCats) {
			continue
		}
		if !matchesDateRange(r, dateRange) {
			continue
		}
		out = append(out, r)
	}
	sortTransactions(out, sortCol, sortAsc)
	return out
}

func matchesSearch(t transaction, query string) bool {
	if query == "" {
		return true
	}
	q := strings.ToLower(query)
	return strings.Contains(strings.ToLower(t.description), q) ||
		strings.Contains(strings.ToLower(t.categoryName), q) ||
		strings.Contains(t.dateISO, q) ||
		strings.Contains(t.dateRaw, q)
}

func matchesCategoryFilter(t transaction, filterCats map[int]bool) bool {
	if len(filterCats) == 0 {
		return true // no filter = show all
	}
	if t.categoryID == nil {
		// Uncategorised: check if 0 (sentinel) is in the filter
		return filterCats[0]
	}
	return filterCats[*t.categoryID]
}

func matchesDateRange(t transaction, dateRange int) bool {
	if dateRange == dateRangeAll {
		return true
	}
	now := time.Now()
	var start time.Time
	switch dateRange {
	case dateRangeThisMonth:
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
	case dateRangeLastMonth:
		prev := now.AddDate(0, -1, 0)
		start = time.Date(prev.Year(), prev.Month(), 1, 0, 0, 0, 0, time.Local)
	case dateRange3Months:
		start = now.AddDate(0, -3, 0)
	case dateRange6Months:
		start = now.AddDate(0, -6, 0)
	default:
		return true
	}
	parsed, err := time.Parse("2006-01-02", t.dateISO)
	if err != nil {
		return true // can't parse = include
	}
	if dateRange == dateRangeLastMonth {
		end := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
		return !parsed.Before(start) && parsed.Before(end)
	}
	return !parsed.Before(start)
}

func sortTransactions(rows []transaction, col int, asc bool) {
	sort.SliceStable(rows, func(i, j int) bool {
		var less bool
		switch col {
		case sortByDate:
			less = rows[i].dateISO < rows[j].dateISO
		case sortByAmount:
			less = rows[i].amount < rows[j].amount
		case sortByCategory:
			less = strings.ToLower(rows[i].categoryName) < strings.ToLower(rows[j].categoryName)
		case sortByDescription:
			less = strings.ToLower(rows[i].description) < strings.ToLower(rows[j].description)
		default:
			less = rows[i].dateISO < rows[j].dateISO
		}
		if asc {
			return less
		}
		return !less
	})
}

func sortColumnName(col int) string {
	switch col {
	case sortByDate:
		return "date"
	case sortByAmount:
		return "amount"
	case sortByCategory:
		return "category"
	case sortByDescription:
		return "description"
	}
	return "date"
}
