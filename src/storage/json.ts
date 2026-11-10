import { chmodSync, mkdirSync, renameSync, writeFileSync } from "node:fs"
import { randomBytes } from "node:crypto"
import { dirname } from "node:path"

export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  const temp = `${path}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`
  writeFileSync(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
  chmodSync(temp, 0o600)
  renameSync(temp, path)
}
