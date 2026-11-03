import { spawnSync } from "node:child_process"
import { dirname } from "node:path"
import { upgradeBinary } from "./app/upgrade"
import { VERSION, cloneOf, compiled } from "./app/version"

/**
 * Commands that run instead of the app (index.tsx imports this first):
 *   jaskmoney --version
 *   jaskmoney upgrade   (or update): the latest release, as installed
 */
export const INSTALLER = "https://raw.githubusercontent.com/jask-aran/jaskmoney/main/scripts/install.sh"

const command = process.argv[2]
if (command === "--version" || command === "-v") {
  console.log(`jaskmoney ${VERSION}`)
  process.exit(0)
}
if (command === "upgrade" || command === "update") process.exit(await upgrade())

async function upgrade(): Promise<number> {
  const clone = compiled ? cloneOf() : process.cwd()
  if (!compiled || clone) {
    console.log(`This jaskmoney is built from a clone${clone ? ` (${clone})` : ""}: update it there with\n  git pull && bun install && bun run build --install`)
    return 0
  }
  // Linux x64: the release binary, fetched here (src/app/upgrade.ts).
  if (process.platform === "linux" && process.arch === "x64" && !process.env.JASKMONEY_FROM_SOURCE) return upgradeBinary()
  // Elsewhere, the installer, which downloads main and builds it.
  let script: string
  try {
    const response = await fetch(INSTALLER, { signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    script = await response.text()
  } catch (error) {
    console.error(`Couldn't fetch the installer (${error instanceof Error ? error.message : error}): ${INSTALLER}`)
    return 1
  }
  console.log(`jaskmoney ${VERSION}: upgrading…`)
  const result = spawnSync("bash", ["-s"], { input: script, stdio: ["pipe", "inherit", "inherit"], env: { ...process.env, JASKMONEY_BIN: dirname(process.execPath) } })
  return result.status ?? 1
}
