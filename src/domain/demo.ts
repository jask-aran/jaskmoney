import { addDays, addMonthsClamped, daysBetween, parseDay } from "./days"
import { PERSON_TO_PERSON } from "./suggest"
import { DEMO_CATEGORIES, MERCHANTS, PEOPLE } from "./demoData"

export { DEMO_CATEGORIES } from "./demoData"
export interface DemoCategory { name: string; color: string; parent: string | null; income?: boolean; notSpending?: boolean }
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

export interface DemoData {
  accounts: DemoAccount[]
  transactions: DemoTransaction[]
  categories: readonly DemoCategory[]
  budget: { monthly: number }
}

const round = (n: number) => Math.round(n * 100) / 100

/** Built-in fictional life only. All randomness comes from the supplied seed. */
export function generateDemo(options: { today: string; years?: number; seed?: number }): DemoData {
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
  const amount = (median: number, spread = 0.3) => round(median * Math.exp(normal() * spread))
  const poisson = (rate: number) => {
    let count = 0
    for (let left = rate; left > 0; left -= 20) {
      const limit = Math.exp(-Math.min(20, left))
      let product = 1, n = 0
      do { product *= random(); n++ } while (product > limit)
      count += n - 1
    }
    return count
  }
  const start = addDays(addMonthsClamped(options.today, -Math.max(1, Math.round(years * 12))), 1)
  const firstMonth = start.slice(0, 8) + "01"
  const totalDays = daysBetween(start, options.today) + 1
  const months: string[] = []
  for (let month = firstMonth; month <= options.today; month = addMonthsClamped(month, 1)) months.push(month)
  const accounts: DemoAccount[] = [
    { key: "spending", name: "Spending", kind: "spending", balance: 1842.67 },
    { key: "holiday", name: "Next adventure", kind: "saver", balance: 4250.32 },
    { key: "emergency", name: "Rainy day", kind: "saver", balance: 9800.55 },
  ]
  const transactions: DemoTransaction[] = []
  const add = (dateISO: string, value: number, description: string, categoryName: string | null, extra: Partial<DemoTransaction> = {}) => {
    if (dateISO < start || dateISO > options.today) return
    transactions.push({ accountKey: "spending", dateISO, amount: round(value), description, categoryName,
      transactionType: "Purchase", message: null, foreignAmount: null, status: "SETTLED", ...extra })
  }
  // Large purchases have two following months of reduced discretionary spending.
  const purchases = [
    { fraction: 0.16, description: "JB Hi-Fi", category: "Technology", value: 1899 },
    { fraction: 0.39, description: "IKEA", category: "Homeware & Appliances", value: 1299 },
    { fraction: 0.63, description: "mycar Tyre & Auto", category: "Car Insurance & Maintenance", value: 1650 },
    { fraction: 0.86, description: "Apple", category: "Technology", value: 1199 },
  ].map(p => ({ ...p, month: Math.floor((months.length - 1) * p.fraction) }))
  let walk = 1
  months.forEach((month, index) => {
    const end = addDays(addMonthsClamped(month, 1), -1)
    const from = month < start ? start : month
    const to = end > options.today ? options.today : end
    const days = daysBetween(from, to) + 1
    const date = () => addDays(from, integer(days))
    const calendarMonth = Number(month.slice(5, 7))
    // Keep ordinary months within budget; calendar events drive the large peaks.
    walk = Math.max(0.75, Math.min(1.15, walk * Math.exp(normal() * 0.12)))
    const tight = purchases.some(p => index > p.month && index <= p.month + 2)
    const social = index % 16 === 8 ? 2.8 : 1
    const season = calendarMonth === 12 ? 2.2 : calendarMonth === 6 || calendarMonth === 3 ? 1.1 : 1
    const discretionary = tight ? 0.25 : walk * season * social
    for (const merchant of MERCHANTS) {
      if (merchant.category === "Groceries") continue
      const multiplier = merchant.essential ? 1 : discretionary
      for (let n = 0, count = poisson(merchant.frequency * days / 30.4375 * multiplier); n < count; n++) {
        add(date(), -amount(merchant.amount, merchant.spread), pick(merchant.names, merchant.names[0] ?? "Coles"), merchant.category)
      }
    }
    if (calendarMonth === 12) add(addDays(month, 18 + integer(5)), -amount(550, 0.1), "Myer", "Gifts & Charity")
    // Fixed calendar bills, with modest annual rises. Rent is a share-house room.
    const rise = Math.floor(index / 12)
    add(addDays(month, 2), -(1320 + rise * 60), "Ray White", "Rent & Mortgage", { transactionType: "Payment" })
    add(addDays(month, 8 + integer(3)), -amount(85, 0.14), "AGL Energy", "Utilities")
    add(addDays(month, 10), -69, "Aussie Broadband", "Internet")
    add(addDays(month, 14), -29, "Boost Mobile", "Mobile Phone")
    add(addDays(month, 17), -59.9, "Fitness First", "Fitness & Wellbeing")
    const subscriptions = [
      { name: "Spotify", value: 11.99, category: "TV, Music & Streaming", active: true },
      { name: "Netflix", value: 16.99, category: "TV, Music & Streaming", active: true },
      { name: "iCloud+", value: 4.49, category: "Apps, Games & Software", active: true },
      { name: "YouTube Premium", value: 14.99, category: "TV, Music & Streaming", active: true },
      { name: "Stan", value: 12, category: "TV, Music & Streaming", active: index < months.length * 0.6 },
      { name: "Canva Pro", value: 17.99, category: "Apps, Games & Software", active: index >= months.length * 0.35 },
    ]
    subscriptions.forEach((s, i) => {
      if (s.active) add(addDays(month, 4 + i * 3), -(s.value + rise), s.name, s.category)
    })
    for (const saver of accounts.filter(a => a.kind === "saver")) {
      add(addDays(end, -1), amount(saver.balance * 0.04 / 12, 0.15), "Savings interest", "Interest", { accountKey: saver.key, transactionType: "Interest" })
    }
    for (const direction of [-1, 1]) {
      const transactionType = direction < 0 ? "Pay Anyone" : "Osko Payment Received"
      if (!PERSON_TO_PERSON.has(transactionType)) throw new Error(`Unsupported demo P2P type: ${transactionType}`)
      for (let n = 0, count = poisson(2); n < count; n++) add(date(), direction * amount(35, 0.45), pick(PEOPLE, "Alex Morgan"), "People", {
        transactionType, message: pick(["Lunch", "Cinema tickets", "Thanks!", "Birthday gift", "Dinner split"], "Lunch"),
      })
    }
    for (const purchase of purchases.filter(p => p.month === index)) add(date(), -purchase.value, purchase.description, purchase.category)
  })
  // Weekly groceries avoid random clusters of several full shops in one week.
  const groceries = MERCHANTS.find(m => m.category === "Groceries")
  if (groceries) for (let date = addDays(start, 1); date <= options.today; date = addDays(date, 7)) {
    add(addDays(date, integer(3) - 1), -amount(groceries.amount, groceries.spread), pick(groceries.names, "Coles"), groceries.category)
  }
  for (let date = addDays(start, 2); date <= options.today; date = addDays(date, 14)) {
    const progress = daysBetween(start, date) / totalDays
    add(date, progress < 0.34 ? 2450 : progress < 0.7 ? 2625 : 2800, "ACME Group Payroll", "Salary", { transactionType: "Salary" })
    add(addDays(date, 1), -amount(350, 0.15), "Holiday savings", "Transfers", { transactionType: "Transfer", transferToKey: "holiday" })
    add(addDays(date, 1), -amount(200, 0.15), "Emergency savings", "Transfers", { transactionType: "Transfer", transferToKey: "emergency" })
  }
  // Three separate holidays, with flights purchased before departure.
  for (let trip = 0; trip < 3; trip++) {
    const date = addDays(start, Math.floor(totalDays * (trip + 0.5) / 3))
    add(addDays(date, -45 + integer(7)), -(850 + integer(400)), pick(["Jetstar", "Qantas", "Virgin Australia"], "Jetstar"), "Holidays & Travel")
    add(date, -620, "Accor", "Holidays & Travel")
    const currency = trip === 1 ? "JPY" : trip === 2 ? "NZD" : "SGD"
    const rate = currency === "JPY" ? 98 : currency === "NZD" ? 1.1 : 0.87
    // These businesses also trade in Australia; foreign currency marks overseas use.
    const names = trip === 1 ? ["7-Eleven", "McDonald's", "Starbucks"] : trip === 2 ? ["Woolworths", "Uber *Trip", "Accor"] : ["7-Eleven", "Starbucks", "McDonald's"]
    for (let day = 0, length = 8 + integer(4); day < length; day++) {
      for (let n = 0, count = 2 + integer(3); n < count; n++) {
        const value = amount(32, 0.5)
        add(addDays(date, day), -value, pick(names, "7-Eleven"), "Holidays & Travel", { foreignAmount: `${currency} -${(value * rate).toFixed(2)}` })
      }
    }
  }
  // Hide exactly 4.5% of spending rows, sampled without replacement.
  const spending = transactions.filter(t => t.amount < 0 && !t.transferToKey)
  const candidates = [...spending]
  for (let n = 0, count = Math.round(spending.length * 0.045); n < count; n++) {
    const index = integer(candidates.length)
    const row = candidates[index]
    if (row) row.categoryName = null
    candidates.splice(index, 1)
  }
  const recent = spending.filter(t => daysBetween(t.dateISO, options.today) <= 3)
  recent.forEach((t, i) => { if (i < 3 || random() < 0.4) t.status = "HELD" })
  transactions.sort((a, b) => a.dateISO < b.dateISO ? -1 : a.dateISO > b.dateISO ? 1 : 0)
  return { accounts, transactions, categories: DEMO_CATEGORIES, budget: { monthly: 4200 } }
}
