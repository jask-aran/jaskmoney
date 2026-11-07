import { expect, test } from "bun:test"
import { dryRunRules } from "./rules"
import type { Rule, Tag } from "./types"
import { category as makeCategory, transaction as makeTransaction } from "../testing/fixtures"

const category = makeCategory({ id: 10, name: "Food", color: "#ffffff", sortOrder: 0 })
const tag: Tag = { id: 20, name: "Weekly", color: "#ffffff", categoryIds: [], about: null, sortOrder: 0, extId: null }
const transaction = makeTransaction({
  description: "Coffee", amount: -5, dateISO: "2026-01-01", accountId: null, accountName: "Local", source: "csv", status: null,
})
const rule: Rule = { id: 1, name: "Food rule", savedFilterId: "coffee", setCategoryId: category.id, addTagIds: [tag.id], enabled: true, sortOrder: 0 }
const filters = [{ id: "coffee", name: "Coffee", expr: "desc:Coffee" }, { id: "follow", name: "Follow", expr: "cat:Food AND tag:Weekly" }]

test("rules use stored order and later rules see earlier category and tag changes", () => {
  const later = { ...rule, id: 2, savedFilterId: "follow", setCategoryId: 11, addTagIds: [], sortOrder: 1 }
  const rows = [{ ...transaction }, { ...transaction, id: 2, description: "Other" }]
  const before = structuredClone(rows)
  const report = dryRunRules(rows, [rule, later], filters, [category], [tag])
  expect(report).toMatchObject({ transactionCount: 2, updatedTransactions: 1, categoryChanges: 2, tagChanges: 1, failedRules: [], changes: [{ id: 1, categoryId: 11, categorySet: true, tagIds: [20] }] })
  expect(report.rules.map((result) => result.matched)).toEqual([1, 1])
  expect(dryRunRules(rows, [later, rule], filters, [category], [tag]).rules.map((result) => result.matched)).toEqual([0, 1])
  expect(rows).toEqual(before)
})

test("reports missing and invalid filters; empty scopes retain zero failures and disabled rules are omitted", () => {
  const rules = [{ ...rule, savedFilterId: "missing" }, { ...rule, id: 2, savedFilterId: "invalid" }, { ...rule, id: 3, enabled: false }]
  const savedFilters = [{ id: "invalid", name: "Bad", expr: "(" }]
  const report = dryRunRules([transaction], rules, savedFilters, [], [])
  expect(report.failedRules).toEqual(["missing", "invalid"])
  const empty = dryRunRules([], rules, savedFilters, [], [])
  expect(empty.failedRules).toEqual([])
  expect(empty.rules[0]?.error).toBeTruthy()
  expect(report.rules).toHaveLength(2)
  expect(report.rules[0]?.error).toBeTruthy()
  expect(report.rules[1]?.error).toBeTruthy()
})

test("a filter that asks Clef can't drive a rule: it fails and matches nothing", () => {
  const savedFilters = [{ id: "coffee", name: "Coffee", expr: 'ask:coffee OR NOT ask:coffee' }]
  const report = dryRunRules([transaction], [rule], savedFilters, [category], [tag])
  expect(report.rules[0]).toMatchObject({ error: expect.stringContaining("ask:"), matched: 0 })
  expect(report.failedRules).toEqual(["coffee"])
})
