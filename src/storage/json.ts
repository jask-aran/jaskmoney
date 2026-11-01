import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { dirname } from "node:path"

/** JSON written whole or not at all (a temporary file, then a rename),
 * owner-only, in an owner-only directory when it makes one. Each write has
 * its own temporary file, so two writers at once (the app and a server, two
 * token refreshes) never write into each other's. */
export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
  // An existing temp file keeps its mode: set it.
  chmodSync(temp, 0o600)
  renameSync(temp, path)
}
