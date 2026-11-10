import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import pkg from "../../package.json" with { type: "json" }

export const VERSION: string = pkg.version

export const compiled = Bun.main.startsWith("/$bunfs/") || /^[A-Z]:[\\/]~BUN[\\/]/.test(Bun.main)

export function cloneOf(execPath: string = process.execPath): string | null {
  const repo = dirname(dirname(execPath))
  return existsSync(join(repo, ".git")) && existsSync(join(repo, "package.json")) ? repo : null
}
