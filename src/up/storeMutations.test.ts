import { expect, spyOn, test } from "bun:test"
import { data } from "../state/dataStore"
import { syncCategoryTree } from "./categories"
import { testEnv } from "../testing/scoped"

test("category pushes deduplicate provider and local IDs", async () => {
  const fetchMock = spyOn(globalThis, "fetch")
  data.init(":memory:")
  const db = data.getDb()!
  try {
    testEnv("JASKMONEY_UP_TOKEN", "test-pat")
    syncCategoryTree(db, [
      { id: "home", name: "Home", parentId: null },
      { id: "food", name: "Food", parentId: "home" },
    ])
    const add = (source: string, externalId: string | null) => Number(db.query(`INSERT INTO transactions
      (date_raw, date_iso, amount, description, source, external_id, ext_categorizable)
      VALUES ('2026-01-01', '2026-01-01', -1, 'Test', ?, ?, 1)`).run(source, externalId).lastInsertRowid)
    const provider = add("up", "remote"), local = add("csv", null)
    data.refresh()
    const category = data.state.categories.find(c => c.extId === "food")!
    fetchMock.mockImplementation(Object.assign(async () => new Response(null, { status: 204 }), { preconnect: globalThis.fetch.preconnect }))
    await data.categorizeTransactions([provider, provider, local, local], category.id)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(data.state.transactions.every(t => t.categoryId === category.id)).toBe(true)
    const fallback = data.state.categories.find(c => c.isDefault)!.id
    const pending = data.categorizeTransactions([local, local], fallback)
    expect(data.state.transactions.find(t => t.id === local)?.categoryId).toBe(fallback)
    await pending
    expect(fetchMock).toHaveBeenCalledTimes(1)
  } finally {
    fetchMock.mockRestore()
    db.close()
  }
})

test("rule application rolls back earlier rows and links when a later link fails", async () => {
  data.init(":memory:")
  const db = data.getDb()!
  try {
    const category = data.state.categories.find(c => !c.isDefault)!.id
    const tag = data.state.tags[0]!.id
    const add = (description: string) => Number(db.query(`INSERT INTO transactions
      (date_raw, date_iso, amount, description) VALUES ('2026-01-01', '2026-01-01', -1, ?)`).run(description).lastInsertRowid)
    const first = add("First"), second = add("Second")
    data.refresh()
    data.setState({
      savedFilters: [{ id: "all", name: "All", expr: "amt:<0" }, { id: "second", name: "Second", expr: "desc:Second" }],
      rules: [
        { id: 1, name: "Valid", savedFilterId: "all", setCategoryId: category, addTagIds: [tag], sortOrder: 0, enabled: true },
        { id: 2, name: "Invalid tag", savedFilterId: "second", setCategoryId: null, addTagIds: [999999], sortOrder: 1, enabled: true },
      ],
    })
    expect((await data.applyRules([first, second], true)).updatedTransactions).toBe(2)
    const before = db.query("SELECT id, category_id, category_source FROM transactions ORDER BY id").all()
    await expect(data.applyRules([first, second])).rejects.toThrow("FOREIGN KEY constraint failed")
    expect(db.query("SELECT id, category_id, category_source FROM transactions ORDER BY id").all()).toEqual(before)
    expect(db.query("SELECT * FROM transaction_tags").all()).toEqual([])
  } finally {
    data.setState({ savedFilters: [], rules: [] })
    db.close()
  }
})

test("a slow Up answer to an older choice never undoes a newer one; undo follows the order of the choices", async () => {
  const fetchMock = spyOn(globalThis, "fetch")
  data.init(":memory:")
  const db = data.getDb()!
  try {
    testEnv("JASKMONEY_UP_TOKEN", "test-pat")
    syncCategoryTree(db, [
      { id: "home", name: "Home", parentId: null },
      { id: "food", name: "Food", parentId: "home" },
      { id: "fuel", name: "Fuel", parentId: "home" },
    ])
    const row = Number(db.query(`INSERT INTO transactions (date_raw, date_iso, amount, description, source, external_id, ext_categorizable)
      VALUES ('2026-01-01', '2026-01-01', -1, 'Test', 'up', 'remote', 1)`).run().lastInsertRowid)
    data.refresh()
    const food = data.state.categories.find((c) => c.extId === "food")!.id
    const fuel = data.state.categories.find((c) => c.extId === "fuel")!.id
    let refuseFirst!: () => void
    let calls = 0
    fetchMock.mockImplementation(Object.assign(async () => {
      if (++calls === 1) {
        await new Promise<void>((resolve) => { refuseFirst = resolve })
        return new Response(JSON.stringify({ errors: [{ status: "422", title: "Invalid", detail: "refused" }] }), { status: 422 })
      }
      return new Response(null, { status: 204 })
    }, { preconnect: globalThis.fetch.preconnect }))
    const first = data.categorizeTransactions([row], food)
    await Bun.sleep(0)
    await data.categorizeTransactions([row], fuel)
    refuseFirst()
    await first.catch(() => {})
    const now = db.query("SELECT category_id AS categoryId, category_source AS source FROM transactions WHERE id = ?").get(row) as { categoryId: number; source: string }
    expect(now).toEqual({ categoryId: fuel, source: "provider" })
    expect(data.state.transactions.find((t) => t.id === row)!.categoryId).toBe(fuel)
    expect(data.undoLabel()).toContain("Fuel")
  } finally {
    fetchMock.mockRestore()
    db.close()
  }
})
