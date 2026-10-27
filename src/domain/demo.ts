import { addDays, addMonthsClamped, daysBetween, parseDay, weekdayIndex } from "./days"
import { isIncome, isOrdinaryFlow, isSpending } from "./moneyRules"
import { PERSON_TO_PERSON } from "./suggest"
import { median, regularCharges } from "./tagGroups"
import { groupByDescription } from "./transactionGroups"
import type { Account, Category, Transaction } from "./types"

interface Pattern { amount: number; spread: number; perMonth: number }
interface Merchant extends Pattern { description: string; categoryName: string | null; weekdays: number[] }
interface Subscription { description: string; categoryName: string | null; amount: number; months: number; days: number }
export interface DemoProfile {
  categoryNames: string[]
  spendingCategories: string[]
  incomeCategory: string | null
  interestCategory: string | null
  merchants: Merchant[]
  subscriptions: Subscription[]
  pay: Pattern & { cadence: "weekly" | "fortnightly" | "monthly" }
  saving: Pattern
  saverBalances: number[]
  spendingBalance: number
  peopleOut: Pattern
  peopleIn: Pattern
  hasForeign: boolean
}
export interface DemoAccount { key: string; name: string; kind: "spending" | "saver"; balance: number }
export interface DemoTransaction {
  accountKey: string
  dateISO: string
  amount: number
  description: string
  categoryName: string | null
  transactionType: string | null
  message: string | null
  foreignAmount: string | null
  status: "SETTLED" | "HELD"
  transferToKey?: string
}

const BUILT_INS: Readonly<Record<string, readonly string[]>> = {
  Groceries: ["Woolworths", "Aldi", "IGA", "Harris Farm Markets", "Bakers Delight", "The Source Bulk Foods"],
  "Restaurants & Cafes": ["Guzman y Gomez", "Grill'd", "Boost Juice", "Zambrero", "Sushi Hub", "Nando's", "Betty's Burgers", "Roll'd"],
  Fuel: ["Ampol", "BP", "7-Eleven", "United Petroleum"],
  "TV, Music & Streaming": ["Spotify", "Disney Plus", "Stan", "Binge"],
  "Holidays & Travel": ["Qantas", "Jetstar", "Virgin Australia", "Webjet"],
  Shopping: ["Kmart", "Target", "Bunnings", "Officeworks"],
  Transport: ["myki", "Opal", "Uber", "13cabs"],
  Health: ["Chemist Warehouse", "Priceline", "Specsavers"],
}
const NAMES = ["Alex Morgan", "Sam Parker", "Jamie Brooks", "Taylor Reed", "Jordan Ellis", "Casey Bell", "Robin Lane", "Riley Stone"]
// Exact public names only. Never retain a bank description suffix (it can contain a name or PayID).
const PUBLIC_MERCHANTS = new Map(
  [...Object.values(BUILT_INS).flat(), "Coles", "Netflix", "Lane Coffee Roasters"]
    .map(name => [name.toLowerCase(), name]),
)
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const PRIVATE_FLOW = /\b(?:transfer|cover|round[\s-]*up|quick[\s-]*save|atm|cash\s*(?:out|withdrawal)|interest|salary|payroll|payid)\b|\$[\w.]|@|\+?\d[\d\s()-]{7,}/i
const round = (n: number) => Math.round(n * 100) / 100

function pattern(rows: readonly Transaction[], months: number, fallback: number): Pattern {
  const amounts = rows.map(t => Math.abs(t.amount)).filter(n => Number.isFinite(n) && n > 0)
  const amount = median(amounts) || fallback
  return { amount, spread: amounts.length ? median(amounts.map(n => Math.abs(n - amount))) / amount : 0.3, perMonth: rows.length / months }
}

/** Only public spending descriptions survive this boundary. No source rows are retained. */
export function demoProfile(transactions: readonly Transaction[], categories: readonly Category[], accounts: readonly Account[]): DemoProfile {
  // Sort by meaning, never by database ids or caller iteration order.
  const orderedCategories = [...categories].sort((a, b) => compare(a.name, b.name))
  const byId = new Map(categories.map(c => [c.id, c]))
  const categoryOf = (t: Transaction) => t.categoryId === null ? undefined : byId.get(t.categoryId)
  const rowCategory = (t: Transaction) => categoryOf(t)?.name ?? t.categoryName
  const valid = transactions.filter(t => parseDay(t.dateISO) && Number.isFinite(t.amount)).sort((a, b) =>
    compare(a.description.trim().toLowerCase(), b.description.trim().toLowerCase()) || compare(a.description, b.description)
    || compare(a.dateISO, b.dateISO) || a.amount - b.amount || compare(rowCategory(a), rowCategory(b)))
  const dates = valid.map(t => t.dateISO).sort()
  const months = Math.max(1, (daysBetween(dates[0] ?? "2000-01-01", dates.at(-1) ?? "2000-01-01") + 1) / 30.4375)
  const income = (c: Category) => c.income || (c.parentId !== null && byId.get(c.parentId)?.income === true)
  const people = (t: Transaction) => /^people$/i.test(rowCategory(t)) || /^people$/i.test(t.categoryName)
    || (t.transactionType !== null && PERSON_TO_PERSON.has(t.transactionType))
  const publicRows = valid.filter(t => {
    const c = categoryOf(t)
    const parent = c?.parentId == null ? undefined : byId.get(c.parentId)
    return isSpending(t) && t.amount < 0 && !people(t) && !isIncome(t) && !t.internal && t.transferAccountId === null
      && !PRIVATE_FLOW.test(t.description) && !PRIVATE_FLOW.test(t.transactionType ?? "")
      && ![t.categoryName, c?.name ?? "", parent?.name ?? ""].some(name => /^(people|transfers)$/i.test(name))
      && !(c && income(c)) && !c?.notSpending && !parent?.notSpending
  })
  const categoryName = (t: Transaction) => {
    const c = categoryOf(t)
    return c && !c.isDefault ? c.name : null
  }
  // Unknown businesses and personal names share the safe path: a synthetic label.
  // Keep their numeric patterns, but never guess that a name is public.
  const descriptions = [...groupByDescription(publicRows).keys()].sort(compare)
  const safeNames = new Map(descriptions.map((key, i) => [key, PUBLIC_MERCHANTS.get(key) ?? `Local merchant ${String(i + 1).padStart(3, "0")}`]))
  const safeRows = publicRows.map(t => ({ ...t, description: safeNames.get(t.description.trim().toLowerCase()) ?? "Local merchant" }))
  const subscriptions = regularCharges(safeRows).filter(s => pattern(s.charges, months, 1).spread < 0.06)
  const recurring = new Set(subscriptions.map(s => s.name.toLowerCase()))
  const commonCategory = (rows: readonly Transaction[]): string | null => {
    const counts = new Map<string | null, number>()
    for (const row of rows) {
      const name = categoryName(row)
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    return [...counts].sort((a, b) => b[1] - a[1] || compare(a[0] ?? "", b[0] ?? ""))[0]?.[0] ?? null
  }
  const payRows = valid.filter(t => t.amount > 0 && isOrdinaryFlow(t) && !people(t) && (isIncome(t) || t.transactionType === "Salary") && t.transactionType !== "Interest")
  const payDates = payRows.map(t => t.dateISO).sort()
  const gap = median(payDates.slice(1).map((d, i) => daysBetween(payDates[i] ?? d, d))) || 30
  const savingRows = valid.filter(t => t.amount < 0 && t.transferAccountId !== null && accounts.some(a => a.id === t.transferAccountId && a.externalKind === "SAVER"))
  return {
    categoryNames: orderedCategories.map(c => c.name),
    spendingCategories: orderedCategories.filter(c => !income(c) && !c.notSpending && !c.isDefault && c.name !== "People" && !categories.some(child => child.parentId === c.id)).map(c => c.name),
    incomeCategory: orderedCategories.find(c => c.name === "Salary" && income(c))?.name ?? orderedCategories.find(income)?.name ?? null,
    interestCategory: orderedCategories.find(c => c.name === "Interest" && income(c))?.name ?? orderedCategories.find(income)?.name ?? null,
    merchants: [...groupByDescription(safeRows).values()].filter(rows => !recurring.has((rows[0]?.description ?? "").trim().toLowerCase())).flatMap(rows => {
      const first = rows[0]
      return first ? [{ description: first.description, categoryName: commonCategory(rows), ...pattern(rows, months, 25), weekdays: rows.map(t => weekdayIndex(t.dateISO)).sort((a, b) => a - b) }] : []
    }).sort((a, b) => compare(a.description, b.description)),
    subscriptions: subscriptions.map(s => ({ description: s.name, categoryName: commonCategory(s.charges), amount: pattern(s.charges, months, 20).amount, months: s.cadence.perMonth <= 1 ? Math.round(1 / s.cadence.perMonth) : 0, days: s.cadence.name === "weekly" ? 7 : 14 })).sort((a, b) => compare(a.description, b.description)),
    pay: { ...pattern(payRows, months, 3100), cadence: gap < 10 ? "weekly" : gap < 22 ? "fortnightly" : "monthly" },
    saving: savingRows.length ? pattern(savingRows, months, 400) : { amount: 400, spread: 0.2, perMonth: 2 },
    saverBalances: accounts.filter(a => a.externalKind === "SAVER").map(a => Math.abs(a.balance ?? 3000)).sort((a, b) => a - b),
    spendingBalance: median(accounts.filter(a => a.externalKind !== "SAVER").map(a => Math.abs(a.balance ?? 1200))) || 1200,
    peopleOut: pattern(valid.filter(t => people(t) && isOrdinaryFlow(t) && t.amount < 0), months, 45),
    peopleIn: pattern(valid.filter(t => people(t) && isOrdinaryFlow(t) && t.amount > 0), months, 35),
    hasForeign: valid.some(t => !!t.foreignAmount),
  }
}

export function generateDemo(profile: DemoProfile, options: { today: string; years?: number; seed?: number }): { accounts: DemoAccount[]; transactions: DemoTransaction[] } {
  if (!parseDay(options.today)) throw new Error("Invalid demo today: expected YYYY-MM-DD")
  const years = options.years ?? 3
  if (!Number.isFinite(years) || years <= 0 || years > 100) throw new Error("Demo years must be greater than 0 and at most 100")
  let state = (options.seed ?? 7) >>> 0
  const random = () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const integer = (n: number) => Math.floor(random() * n)
  const pick = <T>(values: readonly T[], fallback: T): T => values[integer(values.length)] ?? fallback
  const normal = () => Math.sqrt(-2 * Math.log(Math.max(1e-12, random()))) * Math.cos(2 * Math.PI * random())
  const poisson = (rate: number) => {
    // Split high rates to avoid exponential underflow.
    let count = 0
    for (let left = rate; left > 0; left -= 20) {
      const limit = Math.exp(-Math.min(20, left))
      let product = 1, n = 0
      do { product *= random(); n++ } while (product > limit)
      count += n - 1
    }
    return count
  }
  const start = addDays(addMonthsClamped(options.today, -Math.round(years * 12)), 1)
  const totalDays = daysBetween(start, options.today) + 1
  const category = (name: string) => profile.categoryNames.includes(name) ? name : profile.spendingCategories[0] ?? null
  const accounts: DemoAccount[] = [{ key: "spending", name: "Spending", kind: "spending", balance: round(Math.max(250, profile.spendingBalance) * (0.7 + random() * 0.6)) }]
  const balances = profile.saverBalances.length ? profile.saverBalances : [3500, 8200]
  balances.forEach((balance, i) => accounts.push({ key: `saver-${i}`, name: ["Holiday", "Emergency fund", "New wheels"][i] ?? `Savings ${i + 1}`, kind: "saver", balance: round(Math.max(500, balance) * (0.6 + random() * 0.8)) }))
  const savers = accounts.filter(a => a.kind === "saver")
  const transactions: DemoTransaction[] = []
  const uncategorisable: DemoTransaction[] = []
  const add = (dateISO: string, amount: number, description: string, categoryName: string | null, extra: Partial<DemoTransaction> = {}, canUncategorise = false) => {
    if (dateISO < start || dateISO > options.today) return
    const row: DemoTransaction = { accountKey: "spending", dateISO, amount: round(amount), description, categoryName, transactionType: "Purchase", message: null, foreignAmount: null, status: "SETTLED", ...extra }
    transactions.push(row)
    if (canUncategorise) uncategorisable.push(row)
  }
  const jitter = (amount: number, spread = 0.3) => Math.max(0.01, amount * Math.exp(normal() * Math.max(0.18, Math.min(0.9, spread))) * (random() < 0.025 ? 2 + random() * 3 : 1))
  const extras: Merchant[] = []
  const used = new Set([...profile.merchants, ...profile.subscriptions].map(m => m.description.toLowerCase()))
  for (const [name, descriptions] of Object.entries(BUILT_INS)) for (const description of descriptions) {
    if (used.has(description.toLowerCase())) continue
    extras.push({ description, categoryName: category(name), amount: name === "Groceries" ? 65 : name === "Holidays & Travel" ? 120 : 24, spread: 0.6, perMonth: 0.6 + random() * 0.7, weekdays: [] })
  }
  const ranges = extras.map(() => random() < 0.3 ? [random() * 0.4, 0.65 + random() * 0.35] : [0, 1])
  const merchants = [...profile.merchants, ...extras]
  for (let month = start.slice(0, 8) + "01"; month <= options.today; month = addMonthsClamped(month, 1)) {
    const end = addDays(addMonthsClamped(month, 1), -1)
    const from = month < start ? start : month
    const to = end > options.today ? options.today : end
    const days = daysBetween(from, to) + 1
    const progress = daysBetween(start, from) / totalDays
    const quiet = random() < 0.12 ? 0.45 : 1
    const seasonal = Number(month.slice(5, 7)) === 12 ? 1.5 : quiet
    const heavyWeek = random() < 0.2 ? integer(Math.max(1, days - 6)) : -1
    merchants.forEach((m, i) => {
      const range = ranges[i - profile.merchants.length]
      if (range && (progress < (range[0] ?? 0) || progress > (range[1] ?? 1))) return
      const count = poisson(m.perMonth * days / 30.4375 * seasonal * (heavyWeek >= 0 ? 1.35 : 1))
      for (let n = 0; n < count; n++) {
        let offset = heavyWeek >= 0 && random() < 0.4 ? Math.min(days - 1, heavyWeek + integer(7)) : integer(days)
        let date = addDays(from, offset)
        if (m.weekdays.length && random() < 0.6) {
          const target = pick(m.weekdays, 1)
          offset = Math.max(0, Math.min(days - 1, offset + target - weekdayIndex(date)))
          date = addDays(from, offset)
        }
        add(date, -jitter(m.amount, m.spread) * Math.pow(1.035, (progress - 1) * years), m.description, m.categoryName, {}, i >= profile.merchants.length)
      }
    })
  }
  const schedule = (months: number, days: number, callback: (date: string, progress: number) => void, begin = start, finish = options.today) => {
    let index = 0
    for (let date = begin; date <= finish; date = months ? addMonthsClamped(begin, ++index * months) : addDays(date, days)) callback(date, daysBetween(start, date) / totalDays)
  }
  const recurring = (s: Subscription, begin = start, finish = options.today) => {
    schedule(s.months, s.days, (date, p) => add(date, -s.amount * (p < 0.35 ? 0.88 : p < 0.72 ? 0.94 : 1), s.description, s.categoryName), begin, finish)
  }
  profile.subscriptions.forEach(s => recurring(s))
  for (const [description, amount, begin, finish] of [
    ["Canva Pro", 17.99, 0.3, 1], ["Audible", 16.45, 0, 0.65],
  ] satisfies [string, number, number, number][]) recurring({ description, amount, categoryName: category("TV, Music & Streaming"), months: 1, days: 0 }, addDays(start, Math.floor(totalDays * begin)), addDays(start, Math.min(totalDays - 1, Math.floor(totalDays * finish))))
  schedule(profile.pay.cadence === "monthly" ? 1 : 0, profile.pay.cadence === "weekly" ? 7 : 14, (date, p) => add(date, profile.pay.amount * (p < 0.35 ? 0.88 : p < 0.7 ? 0.94 : 1), "ACME Group Payroll", profile.incomeCategory, { transactionType: "Salary" }))
  for (let month = start.slice(0, 8) + "01"; month <= options.today; month = addMonthsClamped(month, 1)) {
    for (const saver of savers) add(addDays(month, 2), 0.5 + random() * 12, "Savings interest", profile.interestCategory, { accountKey: saver.key, transactionType: "Interest" })
    for (let n = 0; n < poisson(profile.saving.perMonth); n++) {
      const saver = pick(savers, accounts[0]!)
      const date = addDays(month, integer(28))
      add(date, -jitter(profile.saving.amount, profile.saving.spread), "Savings transfer", null, { transactionType: "Transfer", transferToKey: saver.key })
      if (random() < 0.15) add(addDays(date, 3), -jitter(profile.saving.amount / 3), "Savings withdrawal", null, { accountKey: saver.key, transactionType: "Transfer", transferToKey: "spending" })
    }
    for (const direction of [-1, 1]) {
      const p = direction < 0 ? profile.peopleOut : profile.peopleIn
      for (let n = 0; n < poisson(Math.max(0.8, p.perMonth)); n++) add(addDays(month, integer(28)), direction * jitter(p.amount, p.spread), pick(NAMES, "Alex Morgan"), profile.categoryNames.includes("People") ? "People" : null, {
        transactionType: direction < 0 ? "Pay Anyone" : "Osko Payment Received", message: random() < 0.4 ? pick(["Lunch", "Cinema tickets", "Thanks!", "Birthday gift"], "Lunch") : null,
      })
    }
  }
  const trips = profile.hasForeign ? 3 : 2
  for (let trip = 0; trip < trips; trip++) {
    const date = addDays(start, Math.floor(totalDays * ((trip + 0.5) / trips)))
    add(addDays(date, -40), -(400 + random() * 900), "Jetstar flights", category("Holidays & Travel"), {}, true)
    const currency = trip % 2 ? "JPY" : "SGD"
    for (let day = 0; day < 8 + integer(5); day++) for (let n = 0; n < 2 + integer(3); n++) {
      const amount = round(jitter(25))
      add(addDays(date, day), -amount, pick(trip % 2 ? ["Tokyo Metro", "Lawson", "Tokyo Museum Cafe"] : ["Singapore MRT", "Ya Kun Kaya Toast", "Gardens by the Bay"], "Travel cafe"), category("Holidays & Travel"), { foreignAmount: `${currency} -${(amount * (currency === "JPY" ? 98 : 0.87)).toFixed(2)}` }, true)
    }
  }
  // Preserve learned merchant categories; hide a sample of the added spending instead.
  const missing = Math.round(transactions.filter(t => t.amount < 0 && !t.transferToKey && t.categoryName !== "People").length * 0.045)
  for (let n = 0; n < missing && uncategorisable.length; n++) {
    const row = uncategorisable.splice(integer(uncategorisable.length), 1)[0]
    if (row) row.categoryName = null
  }
  const recent = transactions.filter(t => t.amount < 0 && !t.transferToKey && daysBetween(t.dateISO, options.today) <= 3)
  recent.forEach((t, i) => { if (i === 0 || random() < 0.4) t.status = "HELD" })
  transactions.sort((a, b) => compare(a.dateISO, b.dateISO))
  return { accounts, transactions }
}
