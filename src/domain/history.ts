import { formatMoney } from "./dashboard"
import { MONTHS, weekdayIndex } from "./days"
import { isUncategorised } from "./moneyRules"
import { descKey } from "./transactionGroups"
import type { Transaction } from "./types"

export const paidText = (method: string) => PAID[method] ?? method
const PAID: Record<string, string> = {
  CONTACTLESS: "tapped in person", CARD_PIN: "card and PIN in person", MAGNETIC_STRIPE: "swiped in person", BAR_CODE: "scanned in person", OCR: "scanned in person",
  ECOMMERCE: "online", CARD_ON_FILE: "saved card (a subscription or an app)", CARD_DETAILS: "card number entered (online or by phone)",
}

function whenText(t: Pick<Transaction, "dateISO" | "dateRaw">): string {
  const [y, m, d] = t.dateISO.split("-").map(Number) as [number, number, number]
  const date = `${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][weekdayIndex(t.dateISO)]} ${d} ${MONTHS[m - 1]} ${y}`
  const time = /T(\d\d:\d\d)/.exec(t.dateRaw ?? "")?.[1]
  return time ? `${date}, ${time}` : date
}

interface RowFactsOptions {
  category?: boolean
  date?: boolean
  when?: boolean
  account?: boolean
  paid?: boolean
  earlier?: string
  merchantNote?: string
  similar?: string[]
}

export function boughtText(t: Pick<Transaction, "bought">, limit = Infinity, nameMax = Infinity): string {
  return (t.bought ?? []).slice(0, limit).map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.name.slice(0, nameMax)}`).join("; ")
}

export function rowFacts(t: Transaction, o: RowFactsOptions = {}): Record<string, string> {
  const tags = t.tagNames.filter((name) => name.toUpperCase() !== "IGNORE")
  return {
    description: t.description.trim(),
    amount: `${t.amount < 0 ? "-" : "+"}${formatMoney(Math.abs(t.amount))}`,
    direction: t.amount < 0 ? "money out" : "money in",
    ...(t.transactionType ? { bank_type: t.transactionType } : {}),
    ...(t.message ? { message: t.message } : {}),
    ...(t.rawText && t.rawText !== t.description ? { bank_text: t.rawText } : {}),
    ...(t.bought?.length ? { bought: boughtText(t, 5, 120) } : {}),
    ...(t.notes.trim() ? { your_note: t.notes.trim() } : {}),
    ...(tags.length ? { tags: tags.join(", ") } : {}),
    ...(t.foreignAmount ? { foreign_amount: t.foreignAmount } : {}),
    ...(o.category && t.categoryId != null && t.categoryName && t.categoryName !== "Uncategorised" ? { category: t.categoryName } : {}),
    ...(o.date ? { date: t.dateISO } : {}),
    ...(o.when ? { when: whenText(t) } : {}),
    ...(o.account && t.accountName ? { account: t.accountName } : {}),
    ...(o.paid && t.cardMethod ? { paid: paidText(t.cardMethod) } : {}),
    ...(o.earlier ? { categorised_before: o.earlier } : {}),
    ...(o.merchantNote ? { merchant_note: o.merchantNote } : {}),
    ...(o.similar?.length ? { similar_messages: o.similar.join("; ") } : {}),
  }
}

export const PERSON_TO_PERSON = new Set(["Payment", "Pay Anyone", "Transfer", "Osko Payment Received", "Payment Received", "Deposit", "EFTPOS Deposit", "EFTPOS Withdrawal"])
export const isPersonToPerson = (t: Pick<Transaction, "transactionType">) => !!t.transactionType && PERSON_TO_PERSON.has(t.transactionType)

export const merchantKey = (description: string) => descKey({ description })

export function categorisedByMerchant(transactions: readonly Transaction[], assignable: ReadonlySet<number>): Map<string, Transaction[]> {
  const byKey = new Map<string, Transaction[]>()
  for (const t of transactions) {
    if (isUncategorised(t) || t.categoryId == null || !assignable.has(t.categoryId)) continue
    const rows = byKey.get(descKey(t)) ?? []
    rows.push(t)
    byKey.set(descKey(t), rows)
  }
  return byKey
}

export interface CategoryCount { categoryId: number; count: number; latest: Transaction }

export function rankCategories(rows: readonly Transaction[]): CategoryCount[] {
  const counts = new Map<number, CategoryCount>()
  for (const row of rows) {
    if (row.categoryId == null) continue
    const entry = counts.get(row.categoryId)
    const latest = !entry || row.dateISO > entry.latest.dateISO || (row.dateISO === entry.latest.dateISO && row.id > entry.latest.id) ? row : entry.latest
    counts.set(row.categoryId, { categoryId: row.categoryId, count: (entry?.count ?? 0) + 1, latest })
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || b.latest.dateISO.localeCompare(a.latest.dateISO) || b.latest.id - a.latest.id)
}

export const EXAMPLE_LENGTH = 40

export function examplesOf(rows: readonly Transaction[], limit: number): string[] {
  const byKey = new Map<string, { description: string; count: number; latest: string }>()
  for (const t of rows) {
    const entry = byKey.get(descKey(t)) ?? { description: t.description.trim(), count: 0, latest: "" }
    entry.count++
    if (t.dateISO > entry.latest) entry.latest = t.dateISO
    byKey.set(descKey(t), entry)
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || b.latest.localeCompare(a.latest)).slice(0, limit)
    .map((e) => (e.description.length > EXAMPLE_LENGTH ? `${e.description.slice(0, EXAMPLE_LENGTH - 1)}…` : e.description))
}

const messageWords = (message: string) => new Set(message.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])

const SIMILAR_MESSAGES = 3

export function similarMessages(history: readonly Transaction[]): (t: Transaction) => string[] {
  const rows = history.filter((h) => h.message?.trim() && h.categoryId != null && h.categoryName && h.categoryName !== "Uncategorised")
  const words = rows.map((h) => messageWords(h.message!))
  const df = new Map<string, number>()
  for (const set of words) for (const w of set) df.set(w, (df.get(w) ?? 0) + 1)
  const idf = (w: string) => Math.log((rows.length + 1) / ((df.get(w) ?? 0) + 1))
  const minScore = Math.log(4)
  return (t) => {
    if (!t.message?.trim()) return []
    const mine = messageWords(t.message)
    return rows.flatMap((h, i) => {
      if (h.id === t.id) return []
      let score = 0
      for (const w of mine) if (words[i]!.has(w)) score += idf(w)
      return score >= minScore ? [{ h, score }] : []
    }).sort((a, b) => b.score - a.score || b.h.dateISO.localeCompare(a.h.dateISO)).slice(0, SIMILAR_MESSAGES)
      .map(({ h }) => `"${h.message!.trim()}" (${h.amount < 0 ? "money out" : "money in"}, ${formatMoney(Math.abs(h.amount))}) → ${h.categoryName}`)
  }
}
