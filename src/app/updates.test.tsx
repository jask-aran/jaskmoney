import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { RGBA } from "@opentui/core"
import { ui } from "../state/uiStore"
import { data } from "../state/dataStore"
import { renderApp } from "../testing/app"
import { tone } from "../theme"
import { checkForUpdate, newer, updateAvailable } from "./updates"
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

test("asks GitHub at most once a day, keeping the answer; offline or off, no notice", async () => {
  const dir = home()
  let asked = 0
  const counting = (async () => { asked++; return new Response(JSON.stringify({ tag_name: "v99.1.0" })) }) as unknown as typeof fetch
  const now = Date.UTC(2026, 10, 2)
  expect(await checkForUpdate({ env: { JASKMONEY_HOME: dir }, fetch: counting, now, force: true })).toBe("99.1.0")
  expect(JSON.parse(readFileSync(join(dir, "update.json"), "utf8"))).toEqual({ checkedAt: now, latest: "v99.1.0" })
  // Later the same day: the kept answer, no request.
  expect(await checkForUpdate({ env: { JASKMONEY_HOME: dir }, fetch: counting, now: now + 3_600_000, force: true })).toBe("99.1.0")
  expect(asked).toBe(1)
  // A day on: asked again.
  await checkForUpdate({ env: { JASKMONEY_HOME: dir }, fetch: counting, now: now + 25 * 3_600_000, force: true })
  expect(asked).toBe(2)
  const offline = (async () => { throw new Error("offline") }) as unknown as typeof fetch
  expect(await checkForUpdate({ env: { JASKMONEY_HOME: home() }, fetch: offline, force: true })).toBeNull()
  expect(await checkForUpdate({ env: { JASKMONEY_HOME: home(), JASKMONEY_NO_UPDATE_CHECK: "1" }, fetch: counting, force: true })).toBeNull()
  // `bun start` (not a built binary) never asks.
  expect(await checkForUpdate({ env: { JASKMONEY_HOME: home() }, fetch: counting })).toBeNull()
  expect(asked).toBe(2)
})

test("a newer release shows in the top bar, in the good tone; enter says how to get it", async () => {
  ui.switchTab("overview")
  const t = await renderApp({ width: 160, height: 40 })
  await t.renderOnce()
  expect(t.captureCharFrame().split("\n")[0]).not.toContain("update ")
  await checkForUpdate({ env: { JASKMONEY_HOME: home() }, fetch: release("v99.0.0"), force: true })
  expect(updateAvailable()).toBe("99.0.0")
  await t.renderOnce()
  const span = t.captureSpans().lines[0]!.spans.find((s) => s.text.includes("update 99.0.0"))
  expect(span).toBeDefined()
  expect(span!.fg.toInts()).toEqual(RGBA.fromHex(tone.good).toInts())
  openBarItem(ui, data, "bar.update")
  expect(ui.state.status).toBe("Jaskmoney 99.0.0 is out: quit (ctrl+c) and run `jaskmoney upgrade`")
  t.renderer.destroy()
})
