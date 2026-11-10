import type { Account, Category, Transaction } from "../domain/types"
import type { JevClient } from "../ai/jev"

export function answeringMerchants(jev: Pick<JevClient, "judge">, p = 0.1): Pick<JevClient, "judge"> {
  return { async judge(questions, state) {
    const isMerchant = (q: (typeof questions)[string]) => typeof q.instructions === "object" && "merchant" in q.instructions
    const merchants = Object.entries(questions).filter(([, q]) => isMerchant(q))
    const rest = Object.fromEntries(Object.entries(questions).filter(([, q]) => !isMerchant(q)))
    const out: Awaited<ReturnType<JevClient["judge"]>> = Object.fromEntries(merchants.map(([id]) => [id, { type: "noul", noul: p }]))
    return Object.keys(rest).length ? { ...out, ...(await jev.judge(rest, state)) } : out
  } }
}

export function transaction(overrides: Partial<Transaction> = {}): Transaction {
  const dateISO = overrides.dateISO ?? "2026-10-05"
  return {
    id: 1, dateRaw: dateISO, dateISO, amount: -10, description: "x",
    categoryId: null, categoryName: "Uncategorised", categoryGroup: "", categoryColor: "#7f849c",
    notes: "", importId: null, accountId: 1, accountName: "A",
    tagNames: [], tagColors: [], tagIds: [], source: "up", status: "SETTLED", transactionType: null, message: null, rawText: null, foreignAmount: null, cardMethod: null, createdMs: null,
    transferAccountId: null, internal: false, excluded: false, income: false,
    ...overrides,
  }
}

export function account(overrides: Partial<Account> = {}): Account {
  const id = overrides.id ?? 1
  return {
    id, name: `Account ${id}`, type: "debit", sortOrder: id, isActive: true,
    source: "up", externalKind: "TRANSACTIONAL", balance: 100, syncEnabled: true,
    ...overrides,
  }
}

export function category(overrides: Partial<Category> = {}): Category {
  const id = overrides.id ?? 1
  return {
    id, name: `Category ${id}`, color: "#fff", sortOrder: id, isDefault: false,
    parentId: null, extId: null, notSpending: false, income: false, budgetIgnored: false,
    ...overrides,
  }
}
