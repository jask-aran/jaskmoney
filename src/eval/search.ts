import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { jevClient } from "../ai/jev"
import { createWorkersAiClient, readWorkersAiCredentials } from "../ai/workersAi"
import { seedDemoDb } from "../db/demoSeed"
import { DEMO_SEED, generateDemo } from "../domain/demo"
import { paydays } from "../domain/budget"
import { SEARCH_FIELDS, parsedSearch, searchFilter, snapPayee } from "../domain/smartSearch"
import { coverQuestions, searchQuestions, searchTermQuestions } from "../domain/questions"
import { categoryUses } from "../domain/suggest"
import { data } from "../state/dataStore"

const CASES: Array<[string, string[], string[]?]> = [
  ["spotify", ["spotify"]],
  ["netflix and stan", ["netflix", "stan"]],
  ["uber trips", ["uber"]],
  ["mcdonalds or guzman", ["mcdonald", "guzman"]],
  ["bakers delight", ["bakers delight"]],
  ["ALDI", ["aldi"]],
  ["money from Sam Parker", ["sam parker"]],
  ["transfers to holiday savings", ["holiday savings"]],
  ["groceries this month", ["groceries", "2026-11-01"]],
  ["booze last 90 days", ["booze", "2026-08-04"]],
  ["takeaway under $20", ["takeaway", "20"]],
  ["interest earned this year", ["interest", "2026-01-01"]],
  ["coffee over $5 last month", ["coffee", "5", "2026-10-01", "2026-10-31"]],
  ["dinners out over $50", ["dinner", "50"]],
  ["flights", ["flight"]],
  ["presents for mum", ["present"]],
  ["stuff for the car", ["fuel"]],
  ["top 10 biggest purchases this year", ["top:10", "2026-01-01"]],
  ["anything over $200 last month", ["200", "2026-10-01"]],
  ["woolworths since 3 March", ["woolworths", "2026-03-03"]],
  ["everything between 1 June and 15 June", ["2026-06-01", "2026-06-15"]],
  ["fuel in September", ["fuel", "2026-09-01", "2026-09-30"]],
  ["spending on 14 October", ["2026-10-14"]],
  ["Din Tai Fung in August", ["din tai fung", "2026-08-01", "2026-08-31"]],
  ["coffee from 1 to 10 October", ["coffee", "2026-10-01", "2026-10-10"]],
  ["spotify since christmas", ["spotify", "2025-12-25"]],
  ["chemist", ["chemist"]],
  ["Patricia Coffee Brewers", ["patricia"]],
  ["seven seeds over $10", ["seven seeds", "10"]],
  ["pay last cycle", ["type:income"]],
]

const today = "2026-11-01"
const path = join(mkdtempSync(join(tmpdir(), "clairic-")), "demo.db")
seedDemoDb(path, generateDemo({ today, years: 3, seed: DEMO_SEED }))
data.init(path)
const rows = data.state.transactions, categories = data.state.categories
const ctx = { today, cycle: { ...data.state.budgetCycle, paydays: paydays(rows) }, categories }
const uses = categoryUses(rows, categories)
const descriptions = [...new Set(rows.map((t) => t.description))]
const jev = jevClient({ timeoutMs: 60_000 })
const clairic = createWorkersAiClient(readWorkersAiCredentials()).clairic

let withC = 0, without = 0, cFail = 0, cMs = 0
const lines: string[] = []
for (const [query, must, mustNot = []] of CASES) {
  const t0 = performance.now()
  const values = await clairic(SEARCH_FIELDS, query, today).catch((e: Error) => e)
  const ms = performance.now() - t0
  cMs += ms
  const [terms, covers] = await Promise.all([
    jev.judge({ ...searchQuestions(categories), ...searchTermQuestions(query) }, { search: query }),
    jev.judge(coverQuestions(categories, true), { search: query, categories_used_for: uses }),
  ])
  const answers = { ...terms, ...covers }
  const build = (v: typeof values | null) => searchFilter(snapPayee(parsedSearch(v instanceof Error ? null : v, answers, categories, query, today), descriptions), ctx)
  if (values instanceof Error) cFail++
  const a = build(values), b = build(null)
  const ok = (e: string) => must.every((m) => e.toLowerCase().includes(m)) && !mustNot.some((m) => e.toLowerCase().includes(m))
  if (ok(a)) withC++
  if (ok(b)) without++
  const cv = values instanceof Error ? `ERROR ${values.message}` : JSON.stringify(Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v?.value ?? null])))
  lines.push(`${ok(a) ? "✓" : "✗"}${ok(b) ? "✓" : "✗"} ${query}  [clairic ${Math.round(ms)}ms ${cv}]\n     with:    ${a}\n     without: ${b}`)
}
console.log(lines.join("\n"))
console.log(`\nright with Clairic ${withC}/${CASES.length}, without ${without}/${CASES.length}; Clairic failed ${cFail}, mean ${Math.round(cMs / CASES.length)}ms`)
process.exit(0)
