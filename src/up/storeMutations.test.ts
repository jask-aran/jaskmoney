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
    expect(await data.categorizeTransactions([provider, provider, local, local], category.id))
      .toBe("Categorized 2 → Food · 1 updated in Up")
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(data.state.transactions.every(t => t.categoryId === category.id)).toBe(true)
    const fallback = data.state.categories.find(c => c.isDefault)!.id
    const pending = data.categorizeTransactions([local, local], fallback)
    // Local-only edits refresh synchronously; the picker reads state immediately.
    expect(data.state.transactions.find(t => t.id === local)?.categoryId).toBe(fallback)
    expect(await pending).toBe("Categorized 1 → Uncategorised")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  } finally {
    fetchMock.mockRestore()
    db.close()
  }
})

test("rule application rolls back earlier rows and links when a later link fails", () => {
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
    expect(data.applyRules([first, second], true).updatedTransactions).toBe(2)
    const before = db.query("SELECT id, category_id, category_source FROM transactions ORDER BY id").all()
    expect(() => data.applyRules([first, second])).toThrow("FOREIGN KEY constraint failed")
    expect(db.query("SELECT id, category_id, category_source FROM transactions ORDER BY id").all()).toEqual(before)
    expect(db.query("SELECT * FROM transaction_tags").all()).toEqual([])
  } finally {
    data.setState({ savedFilters: [], rules: [] })
    db.close()
  }
})


test("sync keeps its error and clears the lock when failure refresh also throws", async () => {
  const fetchMock = spyOn(globalThis, "fetch")
  data.init(":memory:")
  const db = data.getDb()!
  const query = db.query.bind(db)
  const queryMock = spyOn(db, "query")
    .mockImplementationOnce(query)
    .mockImplementationOnce(() => { throw new Error("Refresh failed") })
  try {
    testEnv("JASKMONEY_UP_TOKEN", "test-pat")
    fetchMock.mockRejectedValue(new Error("Offline"))
    await expect(data.syncUp()).rejects.toThrow("Offline")
    expect(queryMock).toHaveBeenCalledTimes(2)
    expect(data.state.upSyncing).toBe(false)
    queryMock.mockRestore()
    expect(query("SELECT last_error FROM sync_state WHERE source = 'up'").get()).toEqual({ last_error: "Offline" })
  } finally {
    queryMock.mockRestore()
    fetchMock.mockRestore()
    db.close()
  }
})
