/**
 * The README's recordings (scripts/cast.ts): the Overview through its
 * charts (the hero), and the setup's tour (--welcome), each demo for
 * exactly one loop of its script, at its own speed, cropped to the demo's
 * pane. Every frame the app drew is kept, held as long as it was.
 *
 *   bun run recordings [binary] [--only=overview,filter,ask,suggest,chart]
 *                                    (default: dist/jaskmoney, built first)
 *
 * Writes docs/screenshots/<scene>.gif (the README's), and
 * dist/recordings/<scene>.mp4 and the loop as asciinema's .cast.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadCategories, openDb } from "../src/db/client"
import { DEMOS, demoLoopMs, demoWorld, tourTopics } from "../src/state/tour"
import { appBinary, draw, startApp, type Cells, type Session } from "./cast"

type DemoId = (typeof DEMOS)[number]["id"]

// The tour's world, as a new install's categories make it, for how long
// each demo's script runs (the Smart search's depends on its words).
const scratch = mkdtempSync(join(tmpdir(), "jaskmoney-rec-"))
const db = openDb(join(scratch, "rec.db"))
const topics = tourTopics(demoWorld(loadCategories(db)))
db.close()
rmSync(scratch, { recursive: true, force: true })

/** What's filmed: how to bring it up, how long a loop is, what's pressed
 * through it, and whether it's cropped to the tour's demo pane. */
interface Scene {
  id: string
  args: string[]
  settings?: object
  loopMs: number
  /** Brings it to just before its loop; resolves with the key that starts
   * it (pressed as the loop begins). */
  setup(app: Session): Promise<string>
  /** Keys pressed `at` ms into the loop. */
  keys?: Array<{ at: number; key: string }>
  pane: boolean
}

/** How the charts draw in: juicy (900 ms, the tour's own speed) on the
 * quadratic curve, an even pace with a short settle. */
const MOTION = { chartSpeed: "juicy", chartCurve: "quadratic" }

/** How long each recording's first frame is held: a look at the screen
 * before it moves (an Overview chart before it draws in), short enough not
 * to read as a hitch. */
const HOLD_MS = 250

/** A tour demo: Welcome › Start, then → to it (each → starts the next
 * demo from its beginning); Charts, the first, starts again with ←. */
const tourDemo = (id: DemoId): Scene => ({
  id, args: ["--welcome"], loopMs: demoLoopMs(id, topics), pane: true, settings: { ui: MOTION },
  async setup(app) {
    await app.waitFor("Skip setup")
    await Bun.sleep(500)
    app.press("Enter")
    await app.waitFor("Skip the tour")
    await Bun.sleep(500)
    const keys = id === "chart" ? ["ArrowRight", "ArrowLeft"] : DEMOS.slice(1, DEMOS.findIndex((d) => d.id === id) + 1).map(() => "ArrowRight")
    for (const key of keys.slice(0, -1)) { app.press(key); await Bun.sleep(150) }
    return keys.at(-1)!
  },
})

/** Keys typed one after another from `at`, `gap` ms apart. */
const typed = (at: number, keys: string[], gap: number) => keys.map((key, i) => ({ at: at + i * gap, key }))

/** The README's hero: a tour of the app on the demo data, from Settings
 * back to Settings so it loops. The Overview (each chart drawing in, MOTION,
 * chart motion "always"): the range and both charts' views changed in turn,
 * then every change undone; Transactions: two filters typed and deleted;
 * Settings for a moment (Budgets is skipped). It starts on Settings, with
 * the loop's first key (1) bringing the Overview up as it was. */
const OVERVIEW_KEYS = [
  { at: 1000, key: "d" }, // 2M: both charts redraw
  { at: 1900, key: "l" }, // the top chart: Daily
  { at: 2700, key: "L" }, // the bottom chart: Available
  { at: 3500, key: "[" }, // the 2M before
  { at: 4400, key: "h" }, // back: Cumulative
  { at: 5200, key: "H" }, // back: Net position
  { at: 6000, key: "]" }, // back: the last 2M
  { at: 6800, key: "D" }, // back: 1M
  { at: 7800, key: "2" }, // Transactions
  { at: 8500, key: "/" },
  ...typed(8800, [..."coffee"], 90),
  ...typed(10300, Array(6).fill("Backspace"), 60),
  ...typed(10900, [..."guzman"], 90),
  ...typed(12400, Array(6).fill("Backspace"), 60),
  { at: 13000, key: "Escape" },
  { at: 13500, key: "4" }, // Settings
]
const overview: Scene = {
  id: "overview", args: ["--demo"], loopMs: 15500, pane: false,
  settings: { ui: { chartMotion: "always", ...MOTION } },
  keys: OVERVIEW_KEYS,
  async setup(app) {
    await app.waitFor("Demo mode")
    await Bun.sleep(1500)
    app.press("4")
    await Bun.sleep(1500)
    return "1"
  },
}

const SCENES: Scene[] = [overview, tourDemo("filter"), tourDemo("ask"), tourDemo("suggest"), tourDemo("chart")]

/** The demo's pane: the box the tour draws below its card, from its
 * corners in the screen's text, in cells. */
function paneCells(lines: string[]): Cells | null {
  const cardEnd = lines.findIndex((l) => l.includes("╰"))
  const top = lines.findIndex((l, r) => r > cardEnd && l.includes("╭"))
  if (top < 0) return null
  const col = lines[top]!.indexOf("╭")
  const right = lines[top]!.indexOf("╮", col)
  const bottom = lines.findIndex((l, r) => r > top && l[col] === "╰")
  return right < 0 || bottom < 0 ? null : { col, row: top, cols: right - col + 1, rows: bottom - top + 1 }
}

/** Records one loop of `scene` live (its keys on time), then draws it. */
async function film(binary: string, scene: Scene): Promise<void> {
  const app = startApp(binary, scene.args, scene.settings)
  let from = 0
  try {
    const key = await scene.setup(app)
    from = app.now()
    app.press(key)
    for (const { at, key } of scene.keys ?? []) {
      const wait = from + at - app.now()
      if (wait > 0) await Bun.sleep(wait)
      app.press(key)
    }
    const left = from + scene.loopMs + 100 - app.now()
    if (left > 0) await Bun.sleep(left)
  } finally {
    app.close()
  }
  // Where a demo's pane is: the first of a few moments that shows it whole.
  const pane = scene.pane ? [0.5, 0.25, 0.75, 0.9].map((f) => paneCells(app.screen(from + scene.loopMs * f))).find(Boolean) : undefined
  if (scene.pane && !pane) throw new Error(`couldn't find ${scene.id}'s pane:\n${app.screen(from + scene.loopMs / 2).join("\n")}`)
  // From when the key's change shows, not the screen before it (an MP4's
  // first frame is its preview): the first write that changes the title
  // row (the demo pane's top, or the Overview's top chart). The app's
  // first writes after a key can be elsewhere (the tour's card).
  const titleRow = pane?.row ?? app.screen(from).findIndex((line, row) => row > 3 && line.startsWith("╭─"))
  let start = app.firstWrite(from)
  while (start < from + 1000 && app.screen(start)[titleRow] === app.screen(from)[titleRow]) {
    const next = app.firstWrite(start)
    if (next === start) break
    start = next
  }
  // Then to the end of that frame: the terminal gets a frame in several
  // writes, a millisecond or so apart (frames are ~16 ms apart); the first
  // alone leaves the old screen below it.
  while (app.firstWrite(start) !== start && app.firstWrite(start) - start < 5) start = app.firstWrite(start)
  const cast = app.cast(start, start + scene.loopMs, HOLD_MS)
  writeFileSync(`dist/recordings/${scene.id}.cast`, cast)
  await draw(cast, scene.loopMs + HOLD_MS, { mp4: `dist/recordings/${scene.id}.mp4`, gif: `docs/screenshots/${scene.id}.gif`, gifWidth: pane ? 1280 : 1600 }, pane ?? undefined)
  console.log(`docs/screenshots/${scene.id}.gif, dist/recordings/${scene.id}.mp4, .cast  ${((scene.loopMs + HOLD_MS) / 1000).toFixed(2)} s${pane ? `, ${pane.cols}×${pane.rows} cells` : ""}`)
}

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",")
const binary = appBinary()
const started = Date.now()
mkdirSync("dist/recordings", { recursive: true })
await Promise.all(SCENES.filter((scene) => !only || only.includes(scene.id)).map((scene) => film(binary, scene)))
console.log(`${((Date.now() - started) / 1000).toFixed(0)} s`)
