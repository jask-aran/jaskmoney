import { afterEach, expect, test } from "bun:test"
import { createCore } from "./core"
import { createLane } from "./lane"
import { emptyCoreState, type CoreState } from "./protocol"
import { createTag } from "../db/client"
import { syncUp } from "../up/sync"
import { createUpClient } from "../up/client"
import { testDb } from "../testing/scoped"
import type { UpPage, UpTransaction } from "../up/types"

/**
 * The core's session and lane machines (core/context Session, core/lane) —
 * frozen: change the code, not these.
 */

const cores: Array<ReturnType<typeof createCore>> = []
afterEach(() => { for (const core of cores.splice(0)) core.close() })

const cx = { progress: () => {}, signal: new AbortController().signal }

/** A core on a memory database with one CSV row and a tag. */
function coreWithRow() {
  const core = createCore()
  cores.push(core)
  core.open(":memory:")
  const db = core.db!
  db.query("INSERT INTO accounts (id, name, type, source) VALUES (100, 'Spending', 'debit', 'csv')").run()
  db.query("INSERT INTO transactions (id, date_raw, date_iso, amount, description, account_id, source) VALUES (1, 'x', '2026-10-01', -5, 'Shop', 100, 'csv')").run()
  const tag = createTag(db, { name: "Holiday", color: "#fff" })
  core.refresh()
  return { core, tag }
}

test("a factory reset is a new session: undo and the clients' caches of the old rows go", async () => {
  const { core, tag } = coreWithRow()
  await core.commands.applyTagPatch({ ids: [1], patch: { [tag]: "add" } })
  expect(core.state.undoLabel).not.toBeNull()
  const before = core.state.session
  core.commands.factoryResetDatabase({})
  expect(core.state.session).toBeGreaterThan(before)
  expect(core.state.undoLabel).toBeNull()
  expect(core.state.transactions).toEqual([])
  expect(await core.commands.undo({})).toEqual({ message: "Nothing to undo" })
})

test("sync is off in demo mode, in the core itself", async () => {
  const { core } = coreWithRow()
  core.commands.enterDemo({})
  await expect(core.commands.syncUp({})).rejects.toThrow("Sync is off in demo mode")
  expect(core.state.upSyncing).toBe(false)
})

test("the database stays put while an Up sync runs", () => {
  const { core } = coreWithRow()
  core.set({ upSyncing: true })
  expect(() => core.commands.enterDemo({})).toThrow("Wait for the Up sync to finish")
  expect(() => core.commands.factoryResetDatabase({})).toThrow("Wait for the Up sync to finish")
  expect(core.state.demo).toBe(false)
})

test("a note's re-ask waits for the running round instead of being dropped", async () => {
  const { core } = coreWithRow()
  const db = core.db!
  const gifts = Number(db.query("INSERT INTO categories (name, color, sort_order) VALUES ('Gifts', '#fff', 91)").run().lastInsertRowid)
  db.query("INSERT INTO category_suggestions (transaction_id, category_id, confidence, source) VALUES (1, ?, 0.5, 'jev')").run(gifts)
  core.refresh()
  let release!: () => void
  const held = new Promise<void>((resolve) => { release = resolve })
  const sent: string[] = []
  const ai = { async judge(questions: Record<string, unknown>) {
    sent.push(JSON.stringify(questions))
    await held
    return Object.fromEntries(Object.keys(questions).map((id) => [id, (questions[id] as { type?: string }).type === "choice"
      ? { type: "choice" as const, choice: `c${gifts}`, confidence: 0.9, probabilities: { [`c${gifts}`]: 0.9 } }
      : { type: "noul" as const, noul: 0.1 }]))
  } }
  const round = core.commands.suggestCategories({}, { ...cx, ai })
  expect(core.state.suggesting).toBe(true)
  const asked = core.commands.updateTransactionNotes({ id: 1, notes: "For Sam" }, { ...cx, ai })
  release()
  await round
  expect(await asked).toBe(true)
  expect(sent.some((q) => q.includes("For Sam"))).toBe(true)
  expect(core.state.suggesting).toBe(false)
})

test("a lane runs one at a time, refuses a second, and clears only its own flag", async () => {
  const state = emptyCoreState()
  const core = { state, set: (patch: Partial<CoreState>) => { Object.assign(state, patch) } }
  const lane = createLane(core, "suggesting", "busy")
  let finish!: () => void
  const first = lane.run(() => new Promise<string>((resolve) => { finish = () => resolve("first") }))
  expect(state.suggesting).toBe(true)
  await expect(lane.run(async () => "second")).rejects.toThrow("busy")
  const waiting = lane.whenIdle(() => state.suggesting)
  finish()
  expect(await first).toBe("first")
  expect(await waiting).toBe(false)
  // A reset mid-run (close) and a newer run: the older run's end leaves the newer's flag.
  let endOld!: () => void
  const old = lane.run(() => new Promise<void>((resolve) => { endOld = resolve }))
  state.suggesting = false
  let endNew!: () => void
  const newer = lane.run(() => new Promise<void>((resolve) => { endNew = resolve }))
  endOld(); await old
  expect(state.suggesting).toBe(true)
  endNew(); await newer
  expect(state.suggesting).toBe(false)
})

test("an Up sync leaves a row Up confirmed a change for while it fetched (keep)", async () => {
  const db = testDb()
  const money = (cents: number) => ({ currencyCode: "AUD", value: (cents / 100).toFixed(2), valueInBaseUnits: cents })
  const row = (category: string): UpTransaction => ({ type: "transactions", id: "t1", attributes: { status: "SETTLED", rawText: "RAW", description: "Shop", message: null, amount: money(-500), foreignAmount: null, createdAt: "2026-02-01T10:00:00+11:00", settledAt: "2026-02-01T12:00:00+11:00", transactionType: null, isCategorizable: true, roundUp: null, cashback: null, cardPurchaseMethod: null }, relationships: {
    account: { data: { type: "accounts", id: "daily" } }, transferAccount: { data: null },
    category: { data: { type: "categories", id: category } }, parentCategory: { data: { type: "categories", id: "good-life" } }, tags: { data: [] },
  } }) as UpTransaction
  const page = <T>(data: T[]) => Response.json({ data, links: { prev: null, next: null } } satisfies UpPage<T>)
  const client = (category: string) => createUpClient({ token: "test-pat", fetch: async (input) => {
    const url = new URL(String(input))
    if (url.pathname.endsWith("/categories")) return page([])
    if (url.pathname.endsWith("/accounts")) return page([{ type: "accounts", id: "daily", attributes: { displayName: "Daily", accountType: "TRANSACTIONAL", ownershipType: "INDIVIDUAL", balance: money(100), createdAt: "2026-01-01T00:00:00+11:00" } }])
    return page([row(category)])
  } })
  await syncUp(db, client("groceries"))
  const id = db.query<{ id: number }, []>("SELECT id FROM transactions").get()!.id
  db.query("UPDATE transactions SET ext_category = 'takeaway', message = 'mine' WHERE id = ?").run(id)
  await syncUp(db, client("groceries"), { keep: new Set([id]) })
  expect(db.query("SELECT ext_category, message FROM transactions WHERE id = ?").get(id)).toEqual({ ext_category: "takeaway", message: "mine" })
  await syncUp(db, client("groceries"))
  expect(db.query("SELECT ext_category FROM transactions WHERE id = ?").get(id)).toEqual({ ext_category: "groceries" })
})
