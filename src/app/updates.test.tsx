import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RGBA } from "@opentui/core"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { renderApp } from "../testing/app"
import { tone } from "../theme"
import { checkForUpdate, describeVersion, newer, updateAvailable } from "./updates"
import { openBarItem } from "./keys"
import { VERSION } from "./version"

const home = () => mkdtempSync(join(tmpdir(), "jaskmoney-update-"))
const release = (tag: string) => (async () => new Response(JSON.stringify({ tag_name: tag }), { status: 200 })) as unknown as typeof fetch
const nothingNewer = () => checkForUpdate({ env: { JASKMONEY_HOME: home() }, fetch: release(`v${VERSION}`), force: true })

afterEach(nothingNewer)

test("only a newer release counts", () => {
  expect(newer("v99.0.0")).toBe("99.0.0")
  expect(newer(`v${VERSION}`)).toBeNull()
  expect(newer("v0.0.1")).toBeNull()
  for (const odd of [undefined, "", "nightly", "v1.2"]) expect(newer(odd)).toBeNull()
})

test("asks GitHub at most every 10 minutes, keeping the answer; offline it keeps what it knew; off, never", async () => {
  const dir = home()
  let asked = 0
  const counting = (async () => { asked++; return new Response(JSON.stringify({ tag_name: "v99.1.0" })) }) as unknown as typeof fetch
  const now = Date.UTC(2026, 10, 2)
  const at = (ms: number) => checkForUpdate({ env: { JASKMONEY_HOME: dir }, fetch: counting, now: now + ms, force: true })
  expect(await at(0)).toBe("99.1.0")
  expect(JSON.parse(readFileSync(join(dir, "update.json"), "utf8"))).toEqual({ checkedAt: now, latest: "v99.1.0" })
  // Five minutes on: the kept answer, no request. Ten: asked again.
  expect(await at(5 * 60_000)).toBe("99.1.0")
  expect(asked).toBe(1)
  await at(10 * 60_000)
  expect(asked).toBe(2)
  const offline = (async () => { throw new Error("offline") }) as unknown as typeof fetch
  expect(await checkForUpdate({ env: { JASKMONEY_HOME: home() }, fetch: offline, force: true })).toBe("99.1.0")
  expect(await checkForUpdate({ env: { JASKMONEY_HOME: home(), JASKMONEY_NO_UPDATE_CHECK: "1" }, fetch: counting, force: true })).toBeNull()
  // `bun start` (not a built binary) never asks.
  expect(await checkForUpdate({ env: { JASKMONEY_HOME: home() }, fetch: counting })).toBeNull()
  expect(asked).toBe(2)
})

test("pointing at the version asks again once its answer is a minute old, and says what it found", async () => {
  const dir = home()
  let tag = "v99.0.0", asked = 0
  const latest = (async () => { asked++; return new Response(JSON.stringify({ tag_name: tag })) }) as unknown as typeof fetch
  const now = Date.UTC(2026, 10, 2)
  const point = (ms: number) => describeVersion({ env: { JASKMONEY_HOME: dir }, fetch: latest, now: now + ms, force: true })
  expect(await point(0)).toBe("Jaskmoney 99.0.0 is out: quit (ctrl+c) and run `jaskmoney upgrade`")
  expect(await point(30_000)).toBe("Jaskmoney 99.0.0 is out: quit (ctrl+c) and run `jaskmoney upgrade`")
  expect(asked).toBe(1)
  tag = `v${VERSION}`
  expect(await point(61_000)).toBe(`Jaskmoney ${VERSION} is the latest`)
  expect(asked).toBe(2)
})

test("the top bar always shows the version; a newer one turns it green; hover, cursor and enter say how to get it", async () => {
  ui.switchTab("overview")
  const t = await renderApp({ width: 160, height: 40 })
  await t.renderOnce()
  const bar = () => t.captureSpans().lines[0]!.spans
  // Tests run from source: a dev build says so.
  expect(bar().some((s) => s.text.includes(`v${VERSION} dev`))).toBe(true)
  expect(bar().some((s) => s.text.includes(" out"))).toBe(false)
  await checkForUpdate({ env: { JASKMONEY_HOME: home() }, fetch: release("v99.0.0"), force: true })
  expect(updateAvailable()).toBe("99.0.0")
  await t.renderOnce()
  const span = bar().find((s) => s.text.includes(`v${VERSION} dev · 99.0.0 out`))
  expect(span).toBeDefined()
  expect(span!.fg.toInts()).toEqual(RGBA.fromHex(tone.good).toInts())
  ui.setStatus("")
  // The cursor on it (keyboard), then a click: the status line says how. From
  // source (this test), it says to pull.
  ui.setState({ focusedSection: "bar.version" })
  await t.renderOnce()
  await Bun.sleep(10)
  expect(ui.state.status).toBe(`Jaskmoney ${VERSION}, from source: git pull to update`)
  ui.setStatus("")
  openBarItem(ui, data, "bar.version")
  await Bun.sleep(10)
  expect(ui.state.status).toBe(`Jaskmoney ${VERSION}, from source: git pull to update`)
  // Hovering it with the mouse does the same.
  ui.setState({ focusedSection: "none" })
  ui.setStatus("")
  const x = t.captureCharFrame().split("\n")[0]!.indexOf(`v${VERSION} dev`)
  await t.mockMouse.moveTo(x + 1, 0)
  await Bun.sleep(10)
  expect(ui.state.status).toBe(`Jaskmoney ${VERSION}, from source: git pull to update`)
  t.renderer.destroy()
})
