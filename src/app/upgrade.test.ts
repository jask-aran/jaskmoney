import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ASSET, upgradeBinary } from "./upgrade"
import { VERSION } from "./version"

const next = VERSION.replace(/\d+$/, (n) => String(Number(n) + 1))

/** GitHub: the latest release `tag`, with these assets served from memory. */
function github(tag: string, assets: Record<string, Uint8Array>): typeof fetch {
  return (async (url: string | URL | Request) => {
    const href = String(url)
    if (href.includes("/releases/latest")) {
      return Response.json({ tag_name: tag, assets: Object.entries(assets).map(([name, bytes]) => ({ name, size: bytes.byteLength, browser_download_url: `https://dl/${name}` })) })
    }
    const name = href.replace("https://dl/", "")
    return assets[name] ? new Response(assets[name]) : new Response("not found", { status: 404 })
  }) as typeof fetch
}

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "jaskmoney-upgrade-"))
  const target = join(dir, "jaskmoney")
  writeFileSync(target, "old")
  let text = ""
  return { target, out: { write: (t: string) => (text += t), isTTY: false }, text: () => text }
}

test("downloads the gzipped binary, checks it runs, and swaps it in", async () => {
  const s = setup()
  const binary = new TextEncoder().encode("new binary ".repeat(1000))
  const code = await upgradeBinary({ target: s.target, out: s.out, fetch: github(`v${next}`, { [`${ASSET}.gz`]: Bun.gzipSync(binary), [ASSET]: new Uint8Array([1]) }), version: () => `jaskmoney ${next}\n` })
  expect(code).toBe(0)
  expect(readFileSync(s.target, "utf8")).toBe("new binary ".repeat(1000))
  expect(existsSync(`${s.target}.new`)).toBe(false)
  expect(s.text()).toContain(`Upgraded jaskmoney ${VERSION} → ${next}`)
})

test("a release without the gzipped one: the plain binary", async () => {
  const s = setup()
  const code = await upgradeBinary({ target: s.target, out: s.out, fetch: github(`v${next}`, { [ASSET]: new TextEncoder().encode("plain") }), version: () => `jaskmoney ${next}` })
  expect(code).toBe(0)
  expect(readFileSync(s.target, "utf8")).toBe("plain")
})

test("already the latest: nothing downloaded", async () => {
  const s = setup()
  const code = await upgradeBinary({ target: s.target, out: s.out, fetch: github(`v${VERSION}`, {}), version: () => { throw new Error("ran") } })
  expect(code).toBe(0)
  expect(s.text()).toBe(`jaskmoney ${VERSION} is the latest\n`)
  expect(readFileSync(s.target, "utf8")).toBe("old")
})

test("a download that doesn't run leaves the old binary", async () => {
  const s = setup()
  const code = await upgradeBinary({ target: s.target, out: s.out, fetch: github(`v${next}`, { [`${ASSET}.gz`]: Bun.gzipSync(new TextEncoder().encode("broken")) }), version: () => "" })
  expect(code).toBe(1)
  expect(readFileSync(s.target, "utf8")).toBe("old")
  expect(existsSync(`${s.target}.new`)).toBe(false)
})
