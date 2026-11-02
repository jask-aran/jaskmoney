import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createSignal } from "solid-js"
import { jaskmoneyHome } from "../storage/home"
import { writeJsonAtomic } from "../storage/json"
import { VERSION, compiled } from "./version"

/**
 * Whether a newer release is out, for the top bar: GitHub's latest release,
 * asked at most once a day (the answer is kept in ~/.jaskmoney/update.json),
 * and only by a built binary (`bun start` is a clone, which updates by
 * pulling). JASKMONEY_NO_UPDATE_CHECK=1 turns it off. Nothing of yours is
 * sent: it's one GET of a public page.
 */
export const LATEST_RELEASE = "https://api.github.com/repos/jask-aran/jaskmoney/releases/latest"
const DAY = 24 * 60 * 60 * 1000

const [available, setAvailable] = createSignal<string | null>(null)
/** The newer version, when there is one. */
export const updateAvailable = available

/** "v1.2.0" → "1.2.0", when it's newer than `current`. */
export function newer(tag: string | undefined, current: string = VERSION): string | null {
  const version = tag?.replace(/^v/, "")
  if (!version || !/^\d+\.\d+\.\d+$/.test(version)) return null
  return Bun.semver.order(version, current) > 0 ? version : null
}

export async function checkForUpdate(options: { env?: Record<string, string | undefined>; fetch?: typeof fetch; now?: number; force?: boolean } = {}): Promise<string | null> {
  const env = options.env ?? process.env
  if ((!compiled && !options.force) || env.JASKMONEY_NO_UPDATE_CHECK) return null
  const file = join(jaskmoneyHome(env), "update.json")
  const now = options.now ?? Date.now()
  let kept: { checkedAt?: number; latest?: string } = {}
  try { kept = JSON.parse(readFileSync(file, "utf8")) } catch { /* none yet */ }
  let latest = kept.latest
  if (!kept.checkedAt || now - kept.checkedAt > DAY) {
    try {
      const response = await (options.fetch ?? fetch)(LATEST_RELEASE, { headers: { Accept: "application/vnd.github+json", "User-Agent": `jaskmoney/${VERSION}` }, signal: AbortSignal.timeout(5000) })
      if (response.ok) latest = ((await response.json()) as { tag_name?: string }).tag_name
      writeJsonAtomic(file, { checkedAt: now, latest })
    } catch { return null /* offline: ask again next start */ }
  }
  const found = newer(latest)
  setAvailable(found)
  return found
}
