/**
 * Test-scoped resources: each is released when the current test finishes
 * (after its afterEach hooks), whether it passed or not.
 */
import { onTestFinished } from "bun:test"
import { openDb, type Db } from "../db/client"

/** Values to put back after the current test, by variable name. */
const savedEnv = new Map<string, string | undefined>()

/** Set an environment variable for the rest of the test; the value it had
 * before the test's first change (or its absence) comes back afterwards.
 * Leaves nothing to restore when the variable already holds `value`. */
export function testEnv(name: string, value: string): void {
  if (!savedEnv.has(name)) {
    if (process.env[name] === value) return
    savedEnv.set(name, process.env[name])
    onTestFinished(() => {
      const previous = savedEnv.get(name)
      savedEnv.delete(name)
      if (previous === undefined) delete process.env[name]
      else process.env[name] = previous
    })
  }
  process.env[name] = value
}

/** A fresh in-memory database, closed after the test. */
export function testDb(): Db {
  const db = openDb(":memory:")
  onTestFinished(() => db.close())
  return db
}
