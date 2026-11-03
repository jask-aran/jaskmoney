import { chmodSync, renameSync, rmSync } from "node:fs"
import { LATEST_RELEASE, newer } from "./updates"
import { VERSION } from "./version"

/**
 * `jaskmoney upgrade` for a release binary (Linux x64): the latest release's
 * binary, gzipped (`jaskmoney-linux-x64.gz`, or the plain one from a release
 * made before it had one), streamed beside this one with a progress line,
 * checked to run, then renamed over it (a running jaskmoney keeps its file).
 */
export const ASSET = "jaskmoney-linux-x64"

type Asset = { name: string; size: number; browser_download_url: string }
type Release = { tag_name?: string; assets?: Asset[] }

export type UpgradeOptions = {
  target?: string
  fetch?: typeof fetch
  out?: { write(text: string): unknown; isTTY?: boolean }
  /** Runs `<binary> --version`; its output must name the release. */
  version?: (binary: string) => string
}

const headers = { Accept: "application/vnd.github+json", "User-Agent": `jaskmoney/${VERSION}` }

export async function upgradeBinary(options: UpgradeOptions = {}): Promise<number> {
  const target = options.target ?? process.execPath
  const get = options.fetch ?? fetch
  const out = options.out ?? process.stdout
  const say = (line: string) => out.write(`${line}\n`)

  let release: Release
  try {
    const response = await get(LATEST_RELEASE, { headers, signal: AbortSignal.timeout(15_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    release = (await response.json()) as Release
  } catch (error) {
    say(`Couldn't ask GitHub for the latest release (${message(error)})`)
    return 1
  }
  const latest = newer(release.tag_name)
  if (!latest) {
    say(`jaskmoney ${VERSION} is the latest`)
    return 0
  }
  const asset = release.assets?.find((a) => a.name === `${ASSET}.gz`) ?? release.assets?.find((a) => a.name === ASSET)
  if (!asset) {
    say(`Jaskmoney ${latest} has no ${ASSET} binary yet: try again in a few minutes`)
    return 1
  }

  const partial = `${target}.new`
  try {
    const response = await get(asset.browser_download_url, { headers: { "User-Agent": headers["User-Agent"] } })
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
    const total = Number(response.headers.get("content-length")) || asset.size
    const bar = progress(out, `${VERSION} → ${latest}`, total)
    let read = 0
    const counted = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) { read += chunk.byteLength; bar.update(read); controller.enqueue(chunk) },
    }))
    const body = asset.name.endsWith(".gz") ? counted.pipeThrough(new DecompressionStream("gzip") as unknown as ReadableWritablePair<Uint8Array, Uint8Array>) : counted
    await Bun.write(partial, new Response(body))
    bar.done()
    chmodSync(partial, 0o755)
    const runs = (options.version ?? versionOf)(partial)
    if (!runs.includes(latest)) throw new Error(`the download doesn't run (it says: ${runs.trim() || "nothing"})`)
    renameSync(partial, target)
  } catch (error) {
    rmSync(partial, { force: true })
    say(`Couldn't upgrade: ${message(error)}`)
    return 1
  }
  say(`Upgraded jaskmoney ${VERSION} → ${latest}`)
  return 0
}

function versionOf(binary: string): string {
  const run = Bun.spawnSync([binary, "--version"], { stderr: "pipe" })
  return `${run.stdout.toString()}${run.stderr.toString()}`
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const mb = (bytes: number) => (bytes / 1e6).toFixed(1)

/** One line, redrawn in place on a terminal (at most every 50 ms):
 *  Downloading 1.0.3 → 1.0.4  ━━━━━━━━━━━━──────────  31.2 / 54.1 MB  12.4 MB/s
 * Elsewhere (a pipe, a log), just the first and last words. */
function progress(out: NonNullable<UpgradeOptions["out"]>, label: string, total: number) {
  const started = performance.now()
  let drawn = 0
  const line = (read: number) => {
    const width = 24
    const filled = total ? Math.min(width, Math.round((read / total) * width)) : 0
    const seconds = (performance.now() - started) / 1000
    const rate = seconds > 0.2 ? `  ${mb(read / seconds)} MB/s` : ""
    const size = total ? `${mb(read)} / ${mb(total)} MB` : `${mb(read)} MB`
    return `\r\x1b[2KDownloading ${label}  \x1b[36m${"━".repeat(filled)}\x1b[2m${"─".repeat(width - filled)}\x1b[0m  ${size}${rate}`
  }
  if (!out.isTTY) out.write(`Downloading ${label}…\n`)
  return {
    update(read: number) {
      if (!out.isTTY || performance.now() - drawn < 50) return
      drawn = performance.now()
      out.write(line(read))
    },
    done() {
      if (out.isTTY) out.write(`${line(total)}\n`)
    },
  }
}
