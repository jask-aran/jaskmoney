import { expect, test } from "bun:test"
import { mkdtempSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDb } from "./client"

test("a new data folder is owner-only, and so are the database and its write-ahead log", () => {
  const dir = join(mkdtempSync(join(tmpdir(), "jaskmoney-perm-")), "home")
  const path = join(dir, "transactions.db")
  const mode = (p: string) => statSync(p).mode & 0o777
  const db = openDb(path)
  db.exec("CREATE TABLE IF NOT EXISTS t (x)")
  db.exec("INSERT INTO t VALUES (1)")
  expect(mode(dir)).toBe(0o700)
  expect(mode(path)).toBe(0o600)
  expect(mode(`${path}-wal`)).toBe(0o600)
  db.close()
  const old = join(dir, "old.db")
  writeFileSync(old, "")
  openDb(old).close()
  expect(mode(old)).toBe(0o600)
})
