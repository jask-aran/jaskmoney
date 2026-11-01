import { generateDemo } from "../../domain/demo"
import { appToday } from "../../domain/days"
import { isSpending } from "../../domain/moneyRules"
import type { Category, Transaction } from "../../domain/types"

/**
 * The setup's demos run on a made-up year (domain/demo's built-in life,
 * nothing of yours), turned into ordinary rows so the real table, filter
 * engine and charts show them. Categories take the store's ids where the
 * names match, so suggestions and icons resolve as they do in the app.
 */
export interface DemoWorld {
  /** Newest first, as the Transactions table sorts. */
  rows: Transaction[]
  spending: Transaction[]
  today: string
}

let cached: { key: string; world: DemoWorld } | null = null

export function demoWorld(categories: Category[]): DemoWorld {
  const today = appToday()
  const key = `${today}:${categories.length}`
  if (cached?.key === key) return cached.world
  const demo = generateDemo({ today, years: 1, seed: 20261101 })
  const byName = new Map(categories.map((c) => [c.name.toLowerCase(), c]))
  const demoCats = new Map(demo.categories.map((c) => [c.name, c]))
  const accounts = new Map(demo.accounts.map((a, i) => [a.key, { id: i + 1, name: a.name }]))
  const rows = demo.transactions
    .filter((t) => t.status === "SETTLED")
    .map((t, i): Transaction => {
      const name = t.categoryName ?? ""
      const ours = name ? byName.get(name.toLowerCase()) : undefined
      const theirs = name ? demoCats.get(name) : undefined
      const account = accounts.get(t.accountKey)
      const internal = !!t.transferToKey
      return {
        id: i + 1, dateRaw: t.dateISO, dateISO: t.dateISO, amount: t.amount, description: t.description,
        categoryId: name ? (ours?.id ?? -(i + 1)) : null,
        categoryName: name, categoryGroup: theirs?.parent ?? "", categoryColor: ours?.color ?? theirs?.color ?? "",
        notes: "", importId: null, accountId: account?.id ?? null, accountName: account?.name ?? "",
        tagNames: [], tagColors: [], tagIds: [], source: "up", status: "SETTLED",
        transactionType: t.transactionType, message: t.message, rawText: t.rawText, foreignAmount: t.foreignAmount, cardMethod: t.cardMethod,
        createdMs: null, transferAccountId: null, internal,
        excluded: internal || !!theirs?.notSpending, income: !!theirs?.income,
      }
    })
    .sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id - a.id)
  const world = { rows, spending: rows.filter(isSpending), today }
  cached = { key, world }
  return world
}
