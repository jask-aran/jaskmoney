package app

import (
	"database/sql"
	"sort"
	"strconv"

	coredb "jaskmoney-v2/core/db"
)

func currentAccountScopeIDs(dbConn *sql.DB) ([]int, error) {
	if dbConn == nil {
		return nil, nil
	}
	selected, err := coredb.LoadSelectedAccounts(dbConn)
	if err != nil {
		return nil, err
	}
	if len(selected) == 0 {
		return nil, nil
	}
	ids := make([]int, 0, len(selected))
	for id := range selected {
		if id <= 0 {
			continue
		}
		ids = append(ids, id)
	}
	sort.Ints(ids)
	if len(ids) == 0 {
		return nil, nil
	}
	return ids, nil
}

func accountScopeLabel(scopeIDs []int) string {
	if len(scopeIDs) == 0 {
		return "all accounts"
	}
	if len(scopeIDs) == 1 {
		return "1 selected account"
	}
	return strconv.Itoa(len(scopeIDs)) + " selected accounts"
}
