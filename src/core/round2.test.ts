import { expect, onTestFinished, spyOn, test } from "bun:test"
import { readFileSync, writeFileSync } from "node:fs"
import { createCore, CONFIG_SETTLE_MS } from "./core"
import { createTag, saveSuggestions, type Db } from "../db/client"
import { syncCategoryTree } from "../up/categories"
import { loadSettingsConfig } from "../state/settingsConfig"
import { testEnv } from "../testing/scoped"
import type { RuleOffer } from "../domain/ruleOffers"

const cx = { progress: () => {}, signal: new AbortController().signal }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function seed(db: Db, rows: number) {
  syncCategoryTree(db, [
    { id: "test-home", name: "Test home", parentId: null },
    { id: "test-food", name: "Test food", parentId: "test-home" },
    { id: "test-fuel", name: "Test fuel", parentId: "test-home" },
  ])
  db.query("INSERT INTO accounts (id, name, type, source, sync_enabled) VALUES (100, 'Test Up', 'debit', 'up', 1)").run()
  for (let id = 1; id <= rows; id++) db.query(`INSERT INTO transactions
    (id, date_raw, date_iso, amount, description, account_id, source, external_id, ext_categorizable)
    VALUES (?, 'x', '2026-10-01', -5, 'Shop', 100, 'up', ?, 1)`).run(id, `row-${id}`)
}

function fixture(rows = 1) {
  const core = createCore()
  core.open(":memory:")
  seed(core.db!, rows)
  core.refresh()
  onTestFinished(() => { core.close(); core.dispose?.() })
  const food = core.state.categories.find((c) => c.extId === "test-food")!.id
  const fuel = core.state.categories.find((c) => c.extId === "test-fuel")!.id
  return { core, db: core.db!, food, fuel }
}

function intercept(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  testEnv("JASKMONEY_UP_TOKEN", "test-pat")
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(Object.assign(
    (input: Parameters<typeof fetch>[0], init?: RequestInit) => handler(String(input), init),
    { preconnect: globalThis.fetch.preconnect },
  ))
  onTestFinished(() => fetchMock.mockRestore())
}
const ok = () => new Response(null, { status: 204 })

function switchDatabase(core: ReturnType<typeof createCore>, rows = 1) {
  const previous = core.db!
  core.open(":memory:")
  seed(core.db!, rows)
  core.refresh()
  onTestFinished(() => previous.close())
}

test("accept stops after a session switch, including the local-only await", async () => {
  const { core, db, food } = fixture()
  db.query("UPDATE transactions SET source = 'csv'").run()
  saveSuggestions(db, [{ transactionId: 1, categoryId: food, confidence: 0.9, source: "jev" }])
  core.refresh()
  const pending = core.commands.acceptSuggestions({ ids: [1] }, cx)
  switchDatabase(core)
  saveSuggestions(core.db!, [{ transactionId: 1, categoryId: food, confidence: 0.5, source: "jev" }])
  core.refresh()
  const version = core.state.version
  await expect(pending).rejects.toThrow("The database changed")
  expect(core.state.version).toBe(version)
  expect(core.state.suggestions[1]?.confidence).toBe(0.5)
  expect(db.query("SELECT COUNT(*) AS n FROM category_suggestions").get()).toEqual({ n: 1 })
})

test("category and tag replies cannot write to a session they no longer own", async () => {
  for (const kind of ["category", "tag"]) {
    const { core, db, food } = fixture()
    const tag = createTag(db, { name: "Trip", color: "#fff" })
    core.refresh()
    const answer = deferred<Response>()
    intercept(() => answer.promise)
    const pending = kind === "category"
      ? core.commands.categorize({ ids: [1], categoryId: food }, cx)
      : core.commands.applyTagPatch({ ids: [1], patch: { [tag]: "add" } })
    const before = db.query("SELECT category_source, ext_category, ext_tags FROM transactions").get()
    switchDatabase(core)
    const version = core.state.version
    answer.resolve(ok())
    await expect(pending).rejects.toThrow("The database changed")
    expect(core.state.version).toBe(version)
    expect(core.state.undoLabel).toBeNull()
    expect(db.query("SELECT category_source, ext_category, ext_tags FROM transactions").get()).toEqual(before)
  }
})

test("a rule stops between category and tag retries when its session changes", async () => {
  const { core, db, food } = fixture()
  const tag = createTag(db, { name: "Trip", color: "#fff" })
  core.refresh()
  core.commands.saveSavedFilter({ filter: { id: "tag-shop", name: "Tag Shop", expr: "desc:shop" } })
  core.commands.createRule({ input: { name: "Tag Shop", savedFilterId: "tag-shop", setCategoryId: null, addTagIds: [tag], enabled: true } })
  const answer = deferred<Response>()
  const calls: string[] = []
  intercept(async (url) => { calls.push(url); return answer.promise })
  const offer: RuleOffer = { source: "repeat", description: "Shop", expr: "desc:shop", categoryId: food, tagId: null, times: 3, categorised: 3, agreeing: 3, waiting: [1], others: [] }
  const pending = core.commands.makeOfferedRule({ offer })
  expect(calls).toHaveLength(1)
  switchDatabase(core)
  const version = core.state.version
  answer.resolve(ok())
  await expect(pending).rejects.toThrow("The database changed")
  expect(calls).toHaveLength(1)
  expect(core.state.version).toBe(version)
  expect(core.state.undoLabel).toBeNull()
  expect(db.query("SELECT COUNT(*) AS n FROM tag_pushes").get()).toEqual({ n: 1 })
})

test("a sync stops fetching and records no error in a replaced session", async () => {
  const { core, db } = fixture()
  const answer = deferred<Response>()
  let calls = 0
  intercept(async () => { calls++; return answer.promise })
  const pending = core.commands.syncUp({})
  switchDatabase(core)
  answer.resolve(Response.json({ data: [], links: { prev: null, next: null } }))
  await expect(pending).rejects.toThrow("The database changed")
  expect(calls).toBe(1)
  expect(db.query("SELECT COUNT(*) AS n FROM sync_state").get()).toEqual({ n: 0 })
})

test("each destructive data command refuses an active sync before changing rows", () => {
  const { core, db } = fixture()
  core.set({ upSyncing: true })
  expect(() => core.commands.clearDatabaseData({})).toThrow("Wait for the Up sync to finish before clearing database data")
  expect(() => core.commands.clearAccountData({ accountId: 100 })).toThrow("Wait for the Up sync to finish before clearing account data")
  expect(() => core.commands.removeAccountData({ accountId: 100 })).toThrow("Wait for the Up sync to finish before removing an account")
  expect(db.query("SELECT COUNT(*) AS n FROM transactions").get()).toEqual({ n: 1 })
})

test("undo refuses a second run while its reverse waits for Up", async () => {
  const { core, food } = fixture()
  let answer: Promise<Response> = Promise.resolve(ok())
  intercept(() => answer)
  await core.commands.categorize({ ids: [1], categoryId: food }, cx)
  const held = deferred<Response>()
  answer = held.promise
  const first = core.commands.undo({})
  await expect(core.commands.undo({})).rejects.toThrow("Undo is already running")
  held.resolve(ok())
  expect((await first).message).toStartWith("Undid: categorised 1")
  expect(await core.commands.undo({})).toEqual({ message: "Nothing to undo" })
})

test("a missing undo category leaves pending rows and the offered rule intact, then drops the undo", async () => {
  const { core, db, food, fuel } = fixture(2)
  db.query("UPDATE transactions SET category_id = ? WHERE id = 1").run(fuel)
  core.refresh()
  intercept(async () => { throw new Error("offline") })
  const offer: RuleOffer = { source: "repeat", description: "Shop", expr: "desc:shop", categoryId: food, tagId: null, times: 3, categorised: 3, agreeing: 3, waiting: [1, 2], others: [] }
  await core.commands.makeOfferedRule({ offer })
  core.commands.deleteCategory({ id: fuel })
  await expect(core.commands.undo({})).rejects.toThrow("Couldn't undo rule Shop → Test food: category not found")
  expect(db.query("SELECT category_source FROM transactions ORDER BY id").all()).toEqual([{ category_source: "pending" }, { category_source: "pending" }])
  expect(core.state.rules).toHaveLength(1)
  expect(core.state.savedFilters.some((f) => f.id === "desc-shop")).toBe(true)
  expect(await core.commands.undo({})).toEqual({ message: "Nothing to undo" })
})

test("restore stops after its awaited local write without changing the next session", async () => {
  const { core, db, food } = fixture()
  db.query("UPDATE transactions SET source = 'csv'").run()
  core.refresh()
  await core.commands.categorize({ ids: [1], categoryId: food }, cx)
  const pending = core.commands.undo({})
  switchDatabase(core)
  const defaultId = core.state.categories.find((c) => c.isDefault)!.id
  core.db!.query("UPDATE transactions SET category_id = ?").run(defaultId)
  core.refresh()
  const version = core.state.version
  await expect(pending).rejects.toThrow("Couldn't undo categorised 1")
  expect(core.state.version).toBe(version)
  expect(core.state.transactions[0]?.categoryId).toBe(defaultId)
})

test("a retry skips every category reserved before workers start and retries after settlement", async () => {
  const { core, food } = fixture(6)
  const held = deferred<Response>()
  let response = held.promise
  const calls: string[] = []
  intercept(async (url) => { calls.push(url); return response })
  const pending = core.commands.categorize({ ids: [1, 2, 3, 4, 5, 6], categoryId: food }, cx)
  expect(calls).toHaveLength(4)
  const retry = core.commands.retryPendingCategories({})
  expect(calls).toHaveLength(4)
  expect(await retry).toEqual({ pushed: 0, rejected: 0, waiting: 0 })
  held.reject(new Error("offline"))
  expect(await pending).toContain("6 waiting for Up")
  response = Promise.resolve(ok())
  expect(await core.commands.retryPendingCategories({})).toEqual({ pushed: 6, rejected: 0, waiting: 0 })
  expect(calls).toHaveLength(12)
})

test("an older settlement preserves a newer reservation and a superseded failure counts no push", async () => {
  const { core, food, fuel } = fixture()
  const old = deferred<Response>(), newer = deferred<Response>()
  let calls = 0
  intercept(() => ++calls === 1 ? old.promise : newer.promise)
  const first = core.commands.categorize({ ids: [1], categoryId: food }, cx)
  const second = core.commands.categorize({ ids: [1], categoryId: fuel }, cx)
  old.reject(new Error("offline"))
  expect(await first).toBe("Categorized 0 → Test food")
  expect(await core.commands.retryPendingCategories({})).toEqual({ pushed: 0, rejected: 0, waiting: 0 })
  expect(calls).toBe(2)
  newer.resolve(ok())
  expect(await second).toBe("Categorized 1 → Test fuel · 1 updated in Up")
})

test("close flushes deferred prefs before reset and cancels all later writes", async () => {
  const { core } = fixture()
  core.commands.saveUiPrefs({ patch: { weekStart: "sunday" }, soon: true })
  core.close()
  expect(loadSettingsConfig().ui?.weekStart).toBe("sunday")
  const path = process.env.JASKMONEY_CONFIG!
  const stored = readFileSync(path, "utf8") + "\n"
  writeFileSync(path, stored)
  await Bun.sleep(CONFIG_SETTLE_MS + 30)
  expect(readFileSync(path, "utf8")).toBe(stored)
  core.open(":memory:")
  expect(core.state.weekStart).toBe("sunday")
})

test("one core registers one exit listener across reopen, and dispose removes it", () => {
  const before = process.listeners("exit")
  const core = createCore()
  const added = process.listeners("exit").filter((listener) => !before.includes(listener))
  expect(added).toHaveLength(1)
  core.open(":memory:")
  core.close()
  core.open(":memory:")
  core.close()
  expect(process.listeners("exit").filter((listener) => !before.includes(listener))).toEqual(added)
  core.dispose()
  core.dispose()
  expect(process.listeners("exit")).toEqual(before)
})
