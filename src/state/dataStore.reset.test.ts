import { describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { data } from "./dataStore"
import { ensureAccount } from "../db/client"

describe("database factory reset", () => {
  test("recreates only the selected SQLite profile", () => {
    const dir = mkdtempSync(join(tmpdir(), "jaskmoney-reset-"))
    const path = join(dir, "transactions.db")
    data.init(path)
    ensureAccount(data.getDb()!, "Disposable", "debit")
    data.refresh()
    expect(data.state.accounts).toHaveLength(1)
    data.factoryResetDatabase()
    expect(existsSync(path)).toBe(true)
    expect(data.state.accounts).toHaveLength(0)
    expect(data.state.categories.some((category) => category.isDefault)).toBe(true)
  })
})
