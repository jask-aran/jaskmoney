/**
 * The README's recordings (scripts/cast.ts): the Overview through its
 * charts (the hero), and the setup's tour (--welcome), each demo for
 * exactly one loop of its script, at its own speed, cropped to the demo's
 * pane. Every frame the app drew is kept, held as long as it was.
 *
 *   bun run recordings [binary] [--only=overview,filter,ask,suggest,chart]
 *                                    (default: dist/jaskmoney, built first)
 *
 * Writes dist/recordings/<scene>.mp4, and the loop as asciinema's .cast.
 * The README plays the MP4s from GitHub's own uploads (docs/media.md).
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadCategories, openDb } from "../src/db/client"
import { CHART_VIEW_MS, DEMOS, demoLoopMs, demoWorld, tourTopics } from "../src/state/tour"
import { CHART_VIEWS } from "../src/state/uiStore"
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

/** The README's hero: the Overview on the demo data, its top chart
 * through every view at the tour's pace (l), each drawing in as it does in
 * the tour (chart motion "always"; a new install draws in once; MOTION). It starts
 * a view back, so the loop ends on the switch it begins with. */
const overview: Scene = {
  id: "overview", args: ["--demo"], loopMs: CHART_VIEW_MS * CHART_VIEWS.length, pane: false,
  settings: { ui: { chartMotion: "always", ...MOTION } },
  keys: Array.from({ length: CHART_VIEWS.length - 1 }, (_, k) => ({ at: (k + 1) * CHART_VIEW_MS, key: "l" })),
  async setup(app) {
    await app.waitFor("Demo mode")
    await Bun.sleep(1500)
    app.press("h")
    await Bun.sleep(CHART_VIEW_MS)
    return "l"
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
  const cast = app.cast(start, start + scene.loopMs, HOLD_MS)
  writeFileSync(`dist/recordings/${scene.id}.cast`, cast)
  await draw(cast, scene.loopMs + HOLD_MS, { mp4: `dist/recordings/${scene.id}.mp4` }, pane ?? undefined)
  console.log(`dist/recordings/${scene.id}.mp4, .cast  ${((scene.loopMs + HOLD_MS) / 1000).toFixed(2)} s${pane ? `, ${pane.cols}×${pane.rows} cells` : ""}`)
}

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",")
const binary = appBinary()
const started = Date.now()
mkdirSync("dist/recordings", { recursive: true })
await Promise.all(SCENES.filter((scene) => !only || only.includes(scene.id)).map((scene) => film(binary, scene)))
console.log(`${((Date.now() - started) / 1000).toFixed(0)} s`)
