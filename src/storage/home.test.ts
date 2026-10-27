import { expect, test } from "bun:test"
import { Database } from "bun:sqlite"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { jaskmoneyHome, legacyPaths, moveToHome } from "./home"
import { saveCredentials } from "../ai/credentials"
import { hasUpToken, readUpToken } from "../up/client"
import { testEnv } from "../testing/scoped"

function oldInstall() {
  const HOME = mkdtempSync(join(tmpdir(), "jaskmoney-home-"))
  const env = { HOME }
  const legacy = legacyPaths(env)
  for (const { from, name } of legacy.files) { mkdirSync(dirname(from), { recursive: true }); writeFileSync(from, `{"file":"${name}"}`) }
  mkdirSync(dirname(legacy.db), { recursive: true })
  const db = new Database(legacy.db)
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (1), (2), (3)")
  return { env, db }
}

test("old data is copied into ~/.jaskmoney once, owner-only, the database as a snapshot; the old files stay", () => {
  const { env, db } = oldInstall()
  const home = jaskmoneyHome(env)
  expect(moveToHome(env).sort()).toEqual(["credentials.json", "oauth.json", "settings.json", "transactions.db"])
  // The database is read with its write-ahead log folded in, while the old one is still open.
  expect(new Database(join(home, "transactions.db"), { readonly: true }).query("SELECT COUNT(*) AS n FROM t").get()).toEqual({ n: 3 })
  db.close()
  expect(readFileSync(join(home, "settings.json"), "utf8")).toBe('{"file":"settings.json"}')
  expect(statSync(home).mode & 0o777).toBe(0o700)
  for (const name of ["settings.json", "credentials.json", "oauth.json", "transactions.db"]) expect(statSync(join(home, name)).mode & 0o777).toBe(0o600)
  for (const { from } of legacyPaths(env).files) expect(existsSync(from)).toBe(true)
  // Never again, and never over what's there.
  writeFileSync(join(home, "settings.json"), "{}")
  expect(moveToHome(env)).toEqual([])
  expect(readFileSync(join(home, "settings.json"), "utf8")).toBe("{}")
})

test("an override says where data is: nothing is moved for it", () => {
  const { env, db } = oldInstall()
  db.close()
  expect(moveToHome({ ...env, JASKMONEY_CONFIG: "/elsewhere/settings.json", JASKMONEY_DB: "/elsewhere/t.db" })).toEqual([])
  expect(existsSync(jaskmoneyHome(env))).toBe(false)
})

test("the Up token is read from credentials.json, over the environment", () => {
  expect(hasUpToken()).toBe(false)
  testEnv("JASKMONEY_UP_TOKEN", "from-env")
  expect(readUpToken()).toBe("from-env")
  saveCredentials({ JASKMONEY_UP_TOKEN: "saved" })
  expect(readUpToken()).toBe("saved")
  expect(hasUpToken()).toBe(true)
})
