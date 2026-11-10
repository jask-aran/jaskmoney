import { Database } from "bun:sqlite"
import { chmodSync, copyFileSync, existsSync, mkdirSync } from "node:fs"
import { join } from "node:path"

export function jaskmoneyHome(env: Record<string, string | undefined> = process.env): string {
  return env.JASKMONEY_HOME || join(env.HOME ?? ".", ".jaskmoney")
}

export function legacyPaths(env: Record<string, string | undefined> = process.env) {
  const home = env.HOME ?? "."
  const config = join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "jaskmoney-opentui")
  return {
    files: ["settings.json", "credentials.json", "oauth.json"].map((name) => ({ name, from: join(config, name) })),
    db: join(home, ".local", "share", "jaskmoney-opentui", "transactions.db"),
  }
}

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
