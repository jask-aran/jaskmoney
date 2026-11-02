import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createSignal } from "solid-js"
import { jaskmoneyHome } from "../storage/home"
import { writeJsonAtomic } from "../storage/json"
import { VERSION, compiled } from "./version"

/**
 * Whether a newer release is out, for the top bar's version: GitHub's
 * latest release, asked every 10 minutes while the app runs (the answer is
 * kept in ~/.jaskmoney/update.json, so a restart doesn't ask again sooner),
 * and again when you point at the version, at most once a minute. Only a
 * built binary asks (`bun start` is a clone, which updates by pulling).
 * JASKMONEY_NO_UPDATE_CHECK=1 turns it off. Nothing of yours is sent: it's
 * one GET of a public page.
 */
export const LATEST_RELEASE = "https://api.github.com/repos/jask-aran/jaskmoney/releases/latest"
export const CHECK_EVERY_MS = 10 * 60 * 1000
const ON_HOVER_MS = 60 * 1000

const [available, setAvailable] = createSignal<string | null>(null)
/** The newer version, when there is one. */
export const updateAvailable = available

/** The top bar's version: "v1.0.1", "v1.0.1 · 1.0.2 out", or run from
 * source (`bun run dev`, `bun start`) rather than a built binary, "v1.0.1 dev". */
export const versionLabel = (): string => `v${VERSION}${compiled ? "" : " dev"}${available() ? ` · ${available()} out` : ""}`

/** "v1.2.0" → "1.2.0", when it's newer than `current`. */
export function newer(tag: string | undefined, current: string = VERSION): string | null {
  const version = tag?.replace(/^v/, "")
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return null
  return Bun.semver.order(version, current) > 0 ? version : null
}

type CheckOptions = { env?: Record<string, string | undefined>; fetch?: typeof fetch; now?: number; force?: boolean; maxAgeMs?: number }

/** The newer version, asking GitHub when the kept answer is older than
 * `maxAgeMs` (default 10 minutes); null when there's none, or offline. */
export async function checkForUpdate(options: CheckOptions = {}): Promise<string | null> {
  const env = options.env ?? process.env
  if ((!compiled && !options.force) || env.JASKMONEY_NO_UPDATE_CHECK) return null
  const file = join(jaskmoneyHome(env), "update.json")
  const now = options.now ?? Date.now()
  let kept: { checkedAt?: number; latest?: string } = {}
  try { kept = JSON.parse(readFileSync(file, "utf8")) } catch { /* none yet */ }
  let latest = kept.latest
  if (!kept.checkedAt || now - kept.checkedAt >= (options.maxAgeMs ?? CHECK_EVERY_MS)) {
    try {
      const response = await (options.fetch ?? fetch)(LATEST_RELEASE, { headers: { Accept: "application/vnd.github+json", "User-Agent": `jaskmoney/${VERSION}` }, signal: AbortSignal.timeout(5000) })
      if (response.ok) latest = ((await response.json()) as { tag_name?: string }).tag_name
      writeJsonAtomic(file, { checkedAt: now, latest })
    } catch { return available() /* offline: keep what we knew */ }
  }
  const found = newer(latest)
  setAvailable(found)
  return found
}

/** Check now and every 10 minutes while the app runs. */
export function watchForUpdates(): () => void {
  void checkForUpdate()
  const timer = setInterval(() => void checkForUpdate(), CHECK_EVERY_MS)
  timer.unref?.()
  return () => clearInterval(timer)
}

/** What the version says when you point at it (hover or cursor), asking
 * GitHub first if the last answer is over a minute old. */
export async function describeVersion(options: CheckOptions = {}): Promise<string> {
  if (!compiled && !options.force) return `Jaskmoney ${VERSION}, from source: git pull to update`
  const found = await checkForUpdate({ ...options, maxAgeMs: ON_HOVER_MS })
  return found ? `Jaskmoney ${found} is out: quit (ctrl+c) and run \`jaskmoney upgrade\`` : `Jaskmoney ${VERSION} is the latest`
}
