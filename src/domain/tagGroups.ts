import { addDays, daysBetween, MONTHS } from "./days"
import { PERSON_TO_PERSON } from "./suggest"
import type { Transaction } from "./types"

export interface TagGroup {
  kind: "trip" | "recurring"
  /** Suggested tag name. */
  name: string
  /** One line describing the group. */
  detail: string
  /** Rows the tag would go on and how sure, ordered by id ascending. */
  rows: Array<{ id: number; confidence: number }>
  /** Trip only: first and last day of in-person spending (YYYY-MM-DD). */
  start?: string
  end?: string
}

export const CURRENCY_PLACES: Readonly<Record<string, string>> = {
  SGD: "Singapore", JPY: "Japan", KRW: "Korea", USD: "USA", GBP: "UK",
  EUR: "Europe", NZD: "New Zealand", IDR: "Indonesia", THB: "Thailand",
  VND: "Vietnam", MYR: "Malaysia", HKD: "Hong Kong", CNY: "China",
  CAD: "Canada", TWD: "Taiwan", PHP: "Philippines",
}

function month(iso: string): string {
  return `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
}

function dateRange(start: string, end: string): string {
  const first = Number(start.slice(8, 10))
  const last = Number(end.slice(8, 10))
  if (start.slice(0, 7) === end.slice(0, 7)) return `${first}–${last} ${month(end)}`
  const from = start.slice(0, 4) === end.slice(0, 4) ? month(start).slice(0, 3) : month(start)
  return `${first} ${from} – ${last} ${month(end)}`
}

const currencyOf = (row: Transaction) => row.foreignAmount?.trim().split(/\s+/)[0]?.toUpperCase() ?? ""
const inPerson = (row: Transaction) => !!row.cardMethod && row.cardMethod !== "ECOMMERCE" && row.cardMethod !== "CARD_ON_FILE"
const byDate = (a: Transaction, b: Transaction) => a.dateISO.localeCompare(b.dateISO) || a.id - b.id

export function detectTrips(transactions: readonly Transaction[]): TagGroup[] {
  const byCurrency = new Map<string, Transaction[]>()
  for (const row of transactions) {
    const currency = currencyOf(row)
    if (!currency) continue
    const rows = byCurrency.get(currency) ?? []
    rows.push(row)
    byCurrency.set(currency, rows)
  }
  const trips: TagGroup[] = []
  for (const [currency, foreignRows] of byCurrency) {
    const runs: Transaction[][] = []
    for (const row of foreignRows.filter(inPerson).sort(byDate)) {
      const run = runs.at(-1)
      const previous = run?.at(-1)
      if (run && previous && daysBetween(previous.dateISO, row.dateISO) <= 7) run.push(row)
      else runs.push([row])
    }
    for (const run of runs) {
      const first = run[0]
      const last = run.at(-1)
      if (run.length < 3 || !first || !last) continue
      const start = first.dateISO
      const end = last.dateISO
      const from = addDays(start, -3)
      const to = addDays(end, 14)
      const anchors = new Set(run.map((row) => row.id))
      const rows = foreignRows.filter((row) => anchors.has(row.id) || (row.dateISO >= from && row.dateISO <= to))
        .map((row) => ({ id: row.id, confidence: anchors.has(row.id) ? 0.95 : 0.85 }))
        .sort((a, b) => a.id - b.id)
      const more = rows.length - run.length
      trips.push({
        kind: "trip", name: `${CURRENCY_PLACES[currency] ?? currency} ${month(start)}`,
        detail: `${run.length} in person${more > 0 ? `, ${more} more in ${currency}` : ""} · ${dateRange(start, end)}`,
        rows, start, end,
      })
    }
  }
  return trips.sort((a, b) => (b.start ?? "").localeCompare(a.start ?? "") || a.name.localeCompare(b.name))
}

const CADENCES = [
  { name: "weekly", min: 5, max: 9 },
  { name: "fortnightly", min: 12, max: 16 },
  { name: "monthly", min: 26, max: 35 },
  { name: "quarterly", min: 84, max: 97 },
  { name: "yearly", min: 355, max: 375 },
]

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? (sorted[middle] ?? 0) : ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
}

export function detectRecurring(transactions: readonly Transaction[]): TagGroup[] {
  const merchants = new Map<string, Transaction[]>()
  for (const row of transactions) {
    if (row.amount >= 0 || (row.transactionType && PERSON_TO_PERSON.has(row.transactionType))) continue
    const key = row.description.trim().toLowerCase()
    const rows = merchants.get(key) ?? []
    rows.push(row)
    merchants.set(key, rows)
  }
  const regular: Array<{ name: string; cadence: string; charges: Transaction[] }> = []
  for (const charges of merchants.values()) {
    if (charges.length < 3) continue
    charges.sort(byDate)
    const latest = charges.at(-1)
    if (!latest) continue
    const gaps = charges.slice(1).map((row, index) => daysBetween(charges[index]?.dateISO ?? row.dateISO, row.dateISO))
    const gap = median(gaps)
    const cadence = CADENCES.find(({ min, max }) => gap >= min && gap <= max
      && gaps.filter((value) => value >= min && value <= max).length / gaps.length >= 0.75)
    if (!cadence) continue
    const amount = median(charges.map((row) => Math.abs(row.amount)))
    if (charges.filter((row) => Math.abs(Math.abs(row.amount) - amount) <= amount * 0.2).length / charges.length < 2 / 3) continue
    regular.push({ name: latest.description.trim(), cadence: cadence.name, charges })
  }
  if (!regular.length) return []
  regular.sort((a, b) => a.name.localeCompare(b.name))
  return [{
    kind: "recurring", name: "Subscriptions",
    detail: regular.map(({ name, cadence }) => `${name} ${cadence}`).join(" · "),
    rows: regular.flatMap(({ charges }) => charges.map((row) => ({ id: row.id, confidence: 0.9 }))).sort((a, b) => a.id - b.id),
  }]
}
