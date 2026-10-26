import { expect, test } from "bun:test"
import { data } from "./dataStore"
import { account, transaction } from "../testing/fixtures"

test("the Transactions rows are computed once per change and shared by every reader", () => {
  data.setState({
    accounts: [account({ id: 1 }), account({ id: 2 })],
    transactions: [
      transaction({ id: 1, accountId: 1, dateISO: "2026-10-02", description: "Coffee" }),
      transaction({ id: 2, accountId: 1, dateISO: "2026-10-03", description: "Bread" }),
      transaction({ id: 3, accountId: 2, dateISO: "2026-10-02", description: "Coffee" }),
      transaction({ id: 4, accountId: 1, dateISO: "2026-10-02", description: "Apples" }),
    ],
    accountSelection: 1, filterQuery: "", filterExpr: null, filterErr: "", sortColumn: "date", sortAscending: false,
  })
  const first = data.scopedTransactions()
  expect(data.scopedTransactions()).toBe(first)
  // Newest first; a day's rows by id.
  expect(first.map((t) => t.id)).toEqual([2, 4, 1])

  data.setFilterLive("coffee")
  expect(data.scopedTransactions().map((t) => t.id)).toEqual([1])
  data.setAccountSelection("all")
  expect(data.scopedTransactions().map((t) => t.id)).toEqual([3, 1])
  data.setFilterLive("")
  data.setState({ sortColumn: "description", sortAscending: true })
  expect(data.scopedTransactions().map((t) => t.description)).toEqual(["Apples", "Bread", "Coffee", "Coffee"])
  data.setState({ transactions: [], accounts: [], accountSelection: "all", sortColumn: "date", sortAscending: false })
})
