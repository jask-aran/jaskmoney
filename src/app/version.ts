import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import pkg from "../../package.json" with { type: "json" }

/** This build's version (package.json; the binary carries it). */
export const VERSION: string = pkg.version

/** Whether this is a built binary (`bun run build`) rather than `bun start`:
 * a compiled entry lives in Bun's embedded file system. */
export const compiled = Bun.main.startsWith("/$bunfs/") || /^[A-Z]:[\\/]~BUN[\\/]/.test(Bun.main)

/** The clone a binary was built in, when it runs from one (dist/jaskmoney,
 * or linked to it): it updates by pulling, not by the installer. */
export function cloneOf(execPath: string = process.execPath): string | null {
  const repo = dirname(dirname(execPath))
  return existsSync(join(repo, ".git")) && existsSync(join(repo, "package.json")) ? repo : null
}
