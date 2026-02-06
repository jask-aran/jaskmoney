package main

import (
	"sort"
	"strings"
	"time"
)

func dashTimeframeLabel(timeframe int) string {
	if timeframe >= 0 && timeframe < len(dashTimeframeLabels) {
		return dashTimeframeLabels[timeframe]
	}
	return dashTimeframeLabels[dashTimeframeThisMonth]
}

// getFilteredRows returns the current filtered/sorted view of transactions.
func (m model) getFilteredRows() []transaction {
	return filteredRows(m.rows, m.searchQuery, m.filterCategories, m.sortColumn, m.sortAscending)
}

func (m model) getDashboardRows() []transaction {
	return filterByTimeframe(m.rows, m.dashTimeframe, m.dashCustomStart, m.dashCustomEnd, time.Now())
}

func (m model) dashboardChartRange(now time.Time) (time.Time, time.Time) {
	start, endExcl, ok := timeframeBounds(m.dashTimeframe, m.dashCustomStart, m.dashCustomEnd, now)
	if ok {
		end := endExcl.AddDate(0, 0, -1)
		if end.Before(start) {
			end = start
		}
		return start, end
	}

	// Fallback to the historical default if timeframe bounds are unavailable.
	end := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	start = end.AddDate(0, 0, -(spendingTrackerDays - 1))
	return start, end
}

// filteredRows returns the subset of m.rows matching active transactions filters,
// sorted by the current sort column/direction.
func filteredRows(rows []transaction, searchQuery string, filterCats map[int]bool, sortCol int, sortAsc bool) []transaction {
	var out []transaction
	for _, r := range rows {
		if !matchesSearch(r, searchQuery) {
			continue
		}
		if !matchesCategoryFilter(r, filterCats) {
			continue
		}
		out = append(out, r)
	}
	sortTransactions(out, sortCol, sortAsc)
	return out
}

func filterByTimeframe(rows []transaction, timeframe int, customStart, customEnd string, now time.Time) []transaction {
	start, end, ok := timeframeBounds(timeframe, customStart, customEnd, now)
	if !ok {
		out := make([]transaction, 0, len(rows))
		out = append(out, rows...)
		return out
	}

	out := make([]transaction, 0, len(rows))
	for _, r := range rows {
		parsed, err := time.ParseInLocation("2006-01-02", r.dateISO, time.Local)
		if err != nil {
			// Keep unparsable rows visible; this matches current transaction filtering behavior.
			out = append(out, r)
			continue
		}
		if !parsed.Before(start) && parsed.Before(end) {
			out = append(out, r)
		}
	}
	return out
}

func timeframeBounds(timeframe int, customStart, customEnd string, now time.Time) (time.Time, time.Time, bool) {
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.Local)
	switch timeframe {
	case dashTimeframeThisMonth:
		start := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
		end := start.AddDate(0, 1, 0)
		return start, end, true
	case dashTimeframeLastMonth:
		end := time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.Local)
		start := end.AddDate(0, -1, 0)
		return start, end, true
	case dashTimeframe1Month:
		return dayStart.AddDate(0, -1, 0), dayStart.AddDate(0, 0, 1), true
	case dashTimeframe2Months:
		return dayStart.AddDate(0, -2, 0), dayStart.AddDate(0, 0, 1), true
	case dashTimeframe3Months:
		return dayStart.AddDate(0, -3, 0), dayStart.AddDate(0, 0, 1), true
	case dashTimeframe6Months:
		return dayStart.AddDate(0, -6, 0), dayStart.AddDate(0, 0, 1), true
	case dashTimeframeYTD:
		start := time.Date(now.Year(), time.January, 1, 0, 0, 0, 0, time.Local)
		return start, dayStart.AddDate(0, 0, 1), true
	case dashTimeframe1Year:
		return dayStart.AddDate(-1, 0, 0), dayStart.AddDate(0, 0, 1), true
	case dashTimeframeCustom:
		if customStart == "" || customEnd == "" {
			return time.Time{}, time.Time{}, false
		}
		start, err := time.ParseInLocation("2006-01-02", customStart, time.Local)
		if err != nil {
			return time.Time{}, time.Time{}, false
		}
		endIncl, err := time.ParseInLocation("2006-01-02", customEnd, time.Local)
		if err != nil {
			return time.Time{}, time.Time{}, false
		}
		if endIncl.Before(start) {
			return time.Time{}, time.Time{}, false
		}
		return start, endIncl.AddDate(0, 0, 1), true
	default:
		return time.Time{}, time.Time{}, false
	}
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
