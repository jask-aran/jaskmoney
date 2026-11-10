import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createSignal } from "solid-js"
import { jaskmoneyHome } from "../storage/home"
import { writeJsonAtomic } from "../storage/json"
import { VERSION, compiled } from "./version"

const LATEST_RELEASE = "https://api.github.com/repos/jask-aran/jaskmoney/releases/latest"
const CHECK_EVERY_MS = 10 * 60 * 1000
const ON_HOVER_MS = 60 * 1000

const [available, setAvailable] = createSignal<string | null>(null)
export const updateAvailable = available

export const versionLabel = (): string => `v${VERSION}${compiled ? "" : " dev"}${available() ? ` · ${available()} out` : ""}`

export function newer(tag: string | undefined, current: string = VERSION): string | null {
  const version = tag?.replace(/^v/, "")
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return null
  return Bun.semver.order(version, current) > 0 ? version : null
}

type CheckOptions = { env?: Record<string, string | undefined>; fetch?: typeof fetch; now?: number; force?: boolean; maxAgeMs?: number }

async function checkForUpdate(options: CheckOptions = {}): Promise<string | null> {
  const env = options.env ?? process.env
  if ((!compiled && !options.force) || env.JASKMONEY_NO_UPDATE_CHECK) return null
  const file = join(jaskmoneyHome(env), "update.json")
  const now = options.now ?? Date.now()
  let kept: { checkedAt?: number; latest?: string } = {}
  try { kept = JSON.parse(readFileSync(file, "utf8")) } catch {}
  let latest = kept.latest
  if (!kept.checkedAt || now - kept.checkedAt >= (options.maxAgeMs ?? CHECK_EVERY_MS)) {
    try {
      const response = await (options.fetch ?? fetch)(LATEST_RELEASE, { headers: { Accept: "application/vnd.github+json", "User-Agent": `jaskmoney/${VERSION}` }, signal: AbortSignal.timeout(5000) })
      if (response.ok) latest = ((await response.json()) as { tag_name?: string }).tag_name
      writeJsonAtomic(file, { checkedAt: now, latest })
    } catch { return available() }
  }
  const found = newer(latest)
  setAvailable(found)
  return found
}

export function watchForUpdates(): () => void {
  void checkForUpdate()
  const timer = setInterval(() => void checkForUpdate(), CHECK_EVERY_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

export async function describeVersion(options: CheckOptions = {}): Promise<string> {
  if (!compiled && !options.force) return `Jaskmoney ${VERSION}, from source: git pull to update`
  const found = await checkForUpdate({ ...options, maxAgeMs: ON_HOVER_MS })
  return found ? `Jaskmoney ${found} is out: quit (ctrl+c) and run \`jaskmoney upgrade\`` : `Jaskmoney ${VERSION} is the latest`
}
