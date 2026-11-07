import { expect, onTestFinished, spyOn, test } from "bun:test"
import { createCore } from "./core"
import { createTag, type Db } from "../db/client"
import { syncCategoryTree } from "../up/categories"
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

test("each destructive data command refuses an active sync before changing rows", () => {
  const { core, db } = fixture()
  core.set({ upSyncing: true })
  expect(() => core.commands.clearDatabaseData({})).toThrow("Wait for the Up sync to finish before clearing database data")
  expect(() => core.commands.clearAccountData({ accountId: 100 })).toThrow("Wait for the Up sync to finish before clearing account data")
  expect(() => core.commands.removeAccountData({ accountId: 100 })).toThrow("Wait for the Up sync to finish before removing an account")
  expect(db.query("SELECT COUNT(*) AS n FROM transactions").get()).toEqual({ n: 1 })
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
