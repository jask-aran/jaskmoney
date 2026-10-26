/**
 * Domain fixtures for tests: complete objects from a few overrides. Defaults
 * are neutral; a test that depends on a value passes it explicitly. Every
 * call returns fresh arrays.
 */
import type { Account, Category, Transaction } from "../domain/types"

/** A settled $10 Up debit on 2026-10-05 in account 1 ("A"), uncategorised.
 * `dateRaw` follows `dateISO` unless given. */
export function transaction(overrides: Partial<Transaction> = {}): Transaction {
  const dateISO = overrides.dateISO ?? "2026-10-05"
  return {
    id: 1, dateRaw: dateISO, dateISO, amount: -10, description: "x",
    categoryId: null, categoryName: "Uncategorised", categoryColor: "#7f849c",
    notes: "", importId: null, accountId: 1, accountName: "A",
    tagNames: [], tagColors: [], tagIds: [], source: "up", status: "SETTLED",
    transferAccountId: null, internal: false, excluded: false,
    ...overrides,
  }
}

/** An active, synced Up transactional debit account with a $100 balance;
 * name ("Account <id>") and sortOrder follow `id` (default 1). */
export function account(overrides: Partial<Account> = {}): Account {
  const id = overrides.id ?? 1
  return {
    id, name: `Account ${id}`, type: "debit", sortOrder: id, isActive: true,
    source: "up", externalKind: "TRANSACTIONAL", balance: 100, syncEnabled: true,
    ...overrides,
  }
}

/** A local, top-level, non-default category; name ("Category <id>") and
 * sortOrder follow `id` (default 1). */
export function category(overrides: Partial<Category> = {}): Category {
  const id = overrides.id ?? 1
  return {
    id, name: `Category ${id}`, color: "#fff", sortOrder: id, isDefault: false,
    parentId: null, extId: null, notSpending: false,
    ...overrides,
  }
}
