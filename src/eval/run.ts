import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { hasJev, jevClient, type JevClient } from "../ai/jev"
import { defaultDbPath, loadCategories, loadTransactions, openDb } from "../db/client"
import { readDemoTruth, seedDemoDb } from "../db/demoSeed"
import { demoSource, generateDemo } from "../domain/demo"
import { appToday } from "../domain/days"
import { merchantKey } from "../domain/history"
import { isUncategorised } from "../domain/moneyRules"
import { data } from "../state/dataStore"
import { jaskmoneyHome } from "../storage/home"
import { scoreSuggestions, suggestionText, type Hidden, type SuggestionReport } from "./score"

const JEV_PRICE_PER_TOKEN = 0.042 / 1e6
const SEED = 29

const args = process.argv.slice(2)
const flag = (name: string) => args.includes(`--${name}`)
const option = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }

const SET = Number(option("set") ?? 0)
if (!Number.isInteger(SET) || SET < 0) throw new Error("--set takes a whole number")
const dir = SET ? join(jaskmoneyHome(), "eval", `set-${SET}`) : join(jaskmoneyHome(), "eval")
const setPath = join(dir, "demo.db")
const metaPath = join(dir, "set.json")
const runsDir = join(dir, "runs")

interface SetMeta { made: string; today: string; rows: number; hidden: number }
interface RunRecord { when: string; set: string; commit: string; note: string; sample: number; seconds: number; usage: Usage; report: SuggestionReport }
interface Usage { requests: number; questions: number; tokens: number; failures: number }

function makeSet(): SetMeta {
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const copy = join(mkdtempSync(join(tmpdir(), "jaskmoney-eval-")), "source.db")
  copyDb(defaultDbPath(), copy)
  const source = openDb(copy)
  const history = demoSource(loadTransactions(source), loadCategories(source))
  source.close()
  const today = appToday()
  const demo = generateDemo({ today, years: 3, seed: SEED + SET * 1000, history, hide: "evaluation" })
  seedDemoDb(setPath, demo)
  const meta: SetMeta = { made: new Date().toISOString(), today, rows: demo.transactions.length, hidden: readDemoTruth(setPath).size }
  writeFileSync(metaPath, JSON.stringify(meta, null, 2), { mode: 0o600 })
  console.log(`made the set: ${meta.rows} rows from ${history.length} of your purchases, ${meta.hidden} hidden`)
  return meta
}

function copyDb(from: string, to: string) {
  const db = new Database(from, { readonly: true })
  try { db.run(`VACUUM INTO '${to.replace(/'/g, "''")}'`) } finally { db.close() }
}

function sample<T extends { id: number }>(rows: T[], limit: number): T[] {
  if (rows.length <= limit) return rows
  let state = SEED
  const random = () => ((state = (state * 1103515245 + 12345) >>> 0) / 2 ** 32)
  const out = [...rows]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!] }
  return out.slice(0, limit).sort((a, b) => a.id - b.id)
}

function counting(jev: JevClient, usage: Usage): Pick<JevClient, "judge"> {
  return {
    async judge(questions, state) {
      usage.requests++
      usage.questions += Object.keys(questions).length
      usage.tokens += Math.ceil(JSON.stringify({ questions, state }).length / 3)
      try { return await jev.judge(questions, state) } catch (error) { usage.failures++; throw error }
    },
  }
}

function previousRun(set: string, size: number): RunRecord | undefined {
  if (!existsSync(runsDir)) return undefined
  return readdirSync(runsDir).filter((f) => f.endsWith(".json")).sort().reverse()
    .map((f) => JSON.parse(readFileSync(join(runsDir, f), "utf8")) as RunRecord)
    .find((r) => r.set === set && r.sample === size)
}

async function main() {
  const meta: SetMeta = flag("fresh") || !existsSync(setPath) ? makeSet() : JSON.parse(readFileSync(metaPath, "utf8"))
  const truth = readDemoTruth(setPath)
  const work = join(mkdtempSync(join(tmpdir(), "jaskmoney-eval-")), "demo.db")
  copyDb(setPath, work)
  data.init(work)
  const rows = data.state.transactions
  const known = new Set(rows.filter((t) => !isUncategorised(t)).map((t) => merchantKey(t.description)))
  const hidden: Hidden[] = rows.filter((t) => truth.has(t.id)).map((t) => ({ id: t.id, truth: truth.get(t.id)!, description: t.description, heldOut: !known.has(merchantKey(t.description)) }))
  const limit = Number(option("limit") ?? hidden.length)
  const chosen = sample(hidden, limit)
  const usage: Usage = { requests: 0, questions: 0, tokens: 0, failures: 0 }
  if (!hasJev()) console.log("Jev isn't set up: history only")
  const started = Date.now()
  const summary = await data.suggestCategories(chosen.map((h) => h.id), hasJev() ? counting(jevClient({ timeoutMs: 60_000 }), usage) : undefined)
  const seconds = (Date.now() - started) / 1000
  const names = new Map(data.state.categories.map((c) => [c.id, c.name]))
  const report = scoreSuggestions(chosen, data.state.suggestions, (id) => names.get(id) ?? `#${id}`)
  const commit = Bun.spawnSync(["git", "rev-parse", "--short", "HEAD"]).stdout.toString().trim()
  const dirty = Bun.spawnSync(["git", "status", "--porcelain", "src"]).stdout.toString().trim() ? "+changes" : ""
  const record: RunRecord = { when: new Date().toISOString(), set: meta.made, commit: commit + dirty, note: option("note") ?? "", sample: chosen.length, seconds, usage, report }
  const previous = previousRun(meta.made, chosen.length)
  mkdirSync(runsDir, { recursive: true, mode: 0o700 })
  writeFileSync(join(runsDir, `${record.when.replace(/[:.]/g, "-")}.json`), JSON.stringify(record, null, 2), { mode: 0o600 })

  console.log(`${SET ? `set ${SET}, ` : ""}set made ${meta.made.slice(0, 10)} (${meta.rows} rows, ${meta.hidden} hidden) · ${chosen.length} rows asked · ${record.commit}${record.note ? ` · ${record.note}` : ""}`)
  console.log(`${summary}`)
  console.log(`${seconds.toFixed(1)}s · ${usage.requests} Jev requests, ${usage.questions} questions, ~${usage.tokens.toLocaleString()} tokens ≈ $${(usage.tokens * JEV_PRICE_PER_TOKEN).toFixed(4)}${usage.failures ? ` · ${usage.failures} failed` : ""}`)
  if (previous) console.log(`compared with ${previous.when.slice(0, 16)} (${previous.commit}${previous.note ? `, ${previous.note}` : ""}): changes in brackets`)
  console.log("")
  for (const line of suggestionText(report, previous?.report)) console.log(line)
  if (flag("misses")) {
    const only = option("misses")?.startsWith("--") ? undefined : option("misses")
    const wrong = chosen.flatMap((h) => {
      const s = data.state.suggestions[h.id]
      const pick = s ? names.get(s.categoryId) : undefined
      return s && pick !== h.truth && (!only || h.truth === only || pick === only) ? [{ ...h, pick, confidence: s.confidence, source: s.source }] : []
    })
    console.log("", `misses${only ? ` (${only})` : ""}: ${wrong.length}`)
    for (const m of wrong.sort((a, b) => a.truth.localeCompare(b.truth) || a.description.localeCompare(b.description)))
      console.log(`  ${m.truth} → ${m.pick} ${Math.round(m.confidence * 100)}% ${m.source}${m.heldOut ? "" : " (known)"}  ${m.description}`)
  }
  process.exit(0)
}

await main()
