import { expect, test } from "bun:test"
import { dryRunRules } from "./rules"
import type { Rule, Tag } from "./types"
import { editorNote, type FormContext } from "../state/settingsForm"
import { ui } from "../state/uiStore"
import { savedFilterOptions } from "../state/savedFilters"
import { category as makeCategory, transaction as makeTransaction } from "../testing/fixtures"

const category = makeCategory({ id: 10, name: "Food", color: "#ffffff", sortOrder: 0 })
const tag: Tag = { id: 20, name: "Weekly", color: "#ffffff", scope: null, sortOrder: 0, extId: null }
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
  expect(empty.rules[0]?.error).toBe("missing: missing")
  expect(report.rules).toHaveLength(2)
  expect(report.rules[0]?.error).toBe("missing: missing")
  expect(report.rules[1]?.error).toBeTruthy()
})

test("samples include only changes, stop at three, and show each rule's own actions", () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ ...transaction, id: i + 1 }))
  const report = dryRunRules(rows, [rule, { ...rule, id: 2 }], filters, [category], [tag])
  expect(report.updatedTransactions).toBe(5)
  expect(report.rules[0]?.samples.map((sample) => sample.transaction.id)).toEqual([1, 2, 3])
  expect(report.rules[0]?.samples[0]).toMatchObject({ categoryId: 10, addedTagIds: [20] })
  expect(report.rules[1]).toMatchObject({ matched: 5, categoryChanges: 0, tagChanges: 0, samples: [] })
})

test("filter and rule editor status covers count, invalid, missing, pending and empty", () => {
  const ctx: FormContext = { accounts: [], categories: [category], tags: [tag], savedFilters: filters, transactions: [transaction, { ...transaction, id: 2, description: "Other" }] }
  const draft = { ...ui.state.settingsDraft, expr: "desc:Coffee", savedFilterId: "coffee" }
  expect(editorNote("filter", draft, ctx)).toMatchObject({ text: "ok · 1 txns", tone: "ok", dot: true })
  expect(editorNote("rule", draft, ctx)).toMatchObject({ text: "ok · 1 txns", tone: "ok" })
  expect(editorNote("filter", { ...draft, expr: "(" }, ctx)).toMatchObject({ text: "invalid: unexpected end of expression", tone: "error" })
  expect(editorNote("filter", { ...draft, expr: " " }, ctx)).toMatchObject({ text: "empty", tone: "muted" })
  expect(editorNote("rule", { ...draft, savedFilterId: "" }, ctx)).toMatchObject({ text: "pending", tone: "muted" })
  expect(editorNote("rule", { ...draft, savedFilterId: "gone" }, ctx)).toMatchObject({ text: "missing: gone", tone: "error" })
  expect(editorNote("rule", draft, { ...ctx, savedFilters: [{ ...filters[0]!, expr: "(" }] })).toMatchObject({ text: "invalid", tone: "error" })
  // Derive names from current IDs, as applyRules does, rather than stale row labels.
  expect(editorNote("filter", { ...draft, expr: "cat:Food AND tag:Weekly" }, { ...ctx, transactions: [{ ...transaction, categoryId: 10, tagIds: [20] }] })).toMatchObject({ text: "ok · 1 txns" })
  expect(editorNote("budget", draft, ctx)?.tone).toBe("muted")
})

test("saved-filter picker sorts by MRU, then name, and searches name and expression", () => {
  const filters = [{ id: "z", name: "Alpha", expr: "desc:Coffee" }, { id: "a", name: "Zulu", expr: "cat:Food" }, { id: "b", name: "Beta", expr: "tag:Weekly" }, { id: "c", name: "Recent", expr: "desc:Train" }]
  const usage = { a: "2026-01-01T00:00:00Z", c: "2026-01-02T00:00:00Z" }
  expect(savedFilterOptions(filters, usage).map((filter) => filter.id)).toEqual(["c", "a", "z", "b"])
  expect(savedFilterOptions(filters, usage, "cff").map((filter) => filter.id)).toEqual(["z"])
  expect(savedFilterOptions(filters, usage, "Bta").map((filter) => filter.id)).toEqual(["b"])
  expect(filters[0]?.id).toBe("z")
})

test("a filter that asks Clef can't drive a rule: it fails and matches nothing", () => {
  const savedFilters = [{ id: "coffee", name: "Coffee", expr: 'ask:coffee OR NOT ask:coffee' }]
  const report = dryRunRules([transaction], [rule], savedFilters, [category], [tag])
  expect(report.rules[0]).toMatchObject({ error: "ask: can't be used in a rule", matched: 0 })
  expect(report.failedRules).toEqual(["coffee"])
})
