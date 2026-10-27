import { Database } from "bun:sqlite"
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

/**
 * All user data lives in one directory, ~/.jaskmoney (JASKMONEY_HOME
 * overrides it): settings.json, credentials.json (keys, the Up token
 * included), oauth.json (browser sign-ins) and transactions.db.
 * JASKMONEY_CONFIG and JASKMONEY_DB still point at other files.
 */
export function jaskmoneyHome(env: Record<string, string | undefined> = process.env): string {
  return env.JASKMONEY_HOME || join(env.HOME ?? ".", ".jaskmoney")
}

/** Where data lived before ~/.jaskmoney. */
export function legacyPaths(env: Record<string, string | undefined> = process.env) {
  const home = env.HOME ?? "."
  const config = join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "jaskmoney-opentui")
  return {
    files: ["settings.json", "credentials.json", "oauth.json"].map((name) => ({ name, from: join(config, name) })),
    db: join(home, ".local", "share", "jaskmoney-opentui", "transactions.db"),
  }
}

/**
 * Once: copy data from the old places into the home directory, each file
 * only when the home has none yet; the database as a consistent snapshot
 * (VACUUM INTO, so a write-ahead log is folded in). The old files stay
 * where they were. Skipped where an override says where data is.
 */
export function moveToHome(env: Record<string, string | undefined> = process.env): string[] {
  const home = jaskmoneyHome(env)
  const legacy = legacyPaths(env)
  const moved: string[] = []
  const ensureHome = () => { mkdirSync(home, { recursive: true, mode: 0o700 }) }
  if (!env.JASKMONEY_CONFIG) {
    for (const { name, from } of legacy.files) {
      const to = join(home, name)
      if (existsSync(to) || !existsSync(from)) continue
      ensureHome()
      copyFileSync(from, to)
      chmodSync(to, 0o600)
      moved.push(name)
    }
  }
  const db = join(home, "transactions.db")
  if (!env.JASKMONEY_DB && !existsSync(db) && existsSync(legacy.db)) {
    ensureHome()
    const source = new Database(legacy.db, { readonly: true })
    try { source.exec(`VACUUM INTO '${db.replaceAll("'", "''")}'`) } finally { source.close() }
    chmodSync(db, 0o600)
    moved.push("transactions.db")
  }
  return moved
}
