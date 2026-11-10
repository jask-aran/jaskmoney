import { onTestFinished } from "bun:test"
import { openDb, type Db } from "../db/client"

const savedEnv = new Map<string, string | undefined>()

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

export function testDb(): Db {
  const db = openDb(":memory:")
  onTestFinished(() => db.close())
  return db
}
