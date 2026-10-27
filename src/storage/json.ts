import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

/** JSON written whole or not at all (a temporary file, then a rename), owner-only. */
export function writeJsonAtomic(path: string, value: unknown, temp = `${path}.tmp`): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
  // An existing temp file keeps its mode: set it.
  chmodSync(temp, 0o600)
  renameSync(temp, path)
}
