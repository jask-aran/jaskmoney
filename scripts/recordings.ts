import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadCategories, openDb } from "../src/db/client"
import { DEMOS, demoLoopMs, demoWorld, tourTopics } from "../src/state/tour"
import { appBinary, draw, startApp, type Cells, type Session } from "./cast"

type DemoId = (typeof DEMOS)[number]["id"]

const scratch = mkdtempSync(join(tmpdir(), "jaskmoney-rec-"))
const db = openDb(join(scratch, "rec.db"))
const topics = tourTopics(demoWorld(loadCategories(db)))
db.close()
rmSync(scratch, { recursive: true, force: true })

interface Scene {
  id: string
  args: string[]
  settings?: object
  loopMs: number
  setup(app: Session): Promise<string>
  keys?: Array<{ at: number; key: string }>
  pane: boolean
}

const MOTION = { chartSpeed: "juicy", chartCurve: "quadratic" }

const HOLD_MS = 250

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

const typed = (at: number, keys: string[], gap: number) => keys.map((key, i) => ({ at: at + i * gap, key }))

const onChart = (at: number, chart: string, step: string) => typed(at - 120, ["v", chart, step], 60)

const OVERVIEW_KEYS = [
  { at: 2200, key: "d" },
  ...onChart(4100, "t", "l"),
  ...onChart(6000, "b", "l"),
  { at: 7900, key: "[" },
  ...onChart(9800, "t", "h"),
  ...onChart(11700, "b", "h"),
  { at: 13600, key: "]" },
  { at: 15500, key: "D" },
  { at: 17400, key: "2" },
  { at: 18600, key: "/" },
  ...typed(19000, [..."coffee"], 130),
  ...typed(21200, Array(6).fill("Backspace"), 70),
  ...typed(22100, [..."guzman"], 130),
  ...typed(24300, Array(6).fill("Backspace"), 70),
  { at: 25100, key: "Escape" },
  { at: 25700, key: "4" },
]
const overview: Scene = {
  id: "overview", args: ["--demo"], loopMs: 27700, pane: false,
  settings: { ui: { chartMotion: "always", ...MOTION } },
  keys: OVERVIEW_KEYS,
  async setup(app) {
    await app.waitFor("Demo mode")
    await Bun.sleep(1500)
    app.press("v"); await Bun.sleep(60); app.press("b")
    await Bun.sleep(300)
    app.press("4")
    await Bun.sleep(1500)
    return "1"
  },
}

const SCENES: Scene[] = [overview, tourDemo("filter"), tourDemo("ask"), tourDemo("suggest"), tourDemo("chart")]

function paneCells(lines: string[]): Cells | null {
  const cardEnd = lines.findIndex((l) => l.includes("╰"))
  const top = lines.findIndex((l, r) => r > cardEnd && l.includes("╭"))
  if (top < 0) return null
  const col = lines[top]!.indexOf("╭")
  const right = lines[top]!.indexOf("╮", col)
  const bottom = lines.findIndex((l, r) => r > top && l[col] === "╰")
  return right < 0 || bottom < 0 ? null : { col, row: top, cols: right - col + 1, rows: bottom - top + 1 }
}

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
  const pane = scene.pane ? [0.5, 0.25, 0.75, 0.9].map((f) => paneCells(app.screen(from + scene.loopMs * f))).find(Boolean) : undefined
  if (scene.pane && !pane) throw new Error(`couldn't find ${scene.id}'s pane:\n${app.screen(from + scene.loopMs / 2).join("\n")}`)
  const titleRow = pane?.row ?? app.screen(from).findIndex((line, row) => row > 3 && line.startsWith("╭─"))
  let start = app.firstWrite(from)
  while (start < from + 1000 && app.screen(start)[titleRow] === app.screen(from)[titleRow]) {
    const next = app.firstWrite(start)
    if (next === start) break
    start = next
  }
  while (app.firstWrite(start) !== start && app.firstWrite(start) - start < 5) start = app.firstWrite(start)
  const cast = app.cast(start, start + scene.loopMs, HOLD_MS)
  writeFileSync(`dist/recordings/${scene.id}.cast`, cast)
  await draw(cast, scene.loopMs + HOLD_MS, { mp4: `dist/recordings/${scene.id}.mp4`, gif: `docs/${scene.id}.gif`, gifWidth: pane ? 1280 : 1600 }, pane ?? undefined)
  console.log(`docs/${scene.id}.gif, dist/recordings/${scene.id}.mp4, .cast  ${((scene.loopMs + HOLD_MS) / 1000).toFixed(2)} s${pane ? `, ${pane.cols}×${pane.rows} cells` : ""}`)
}

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",")
const binary = appBinary()
const started = Date.now()
mkdirSync("dist/recordings", { recursive: true })
await Promise.all(SCENES.filter((scene) => !only || only.includes(scene.id)).map((scene) => film(binary, scene)))
console.log(`${((Date.now() - started) / 1000).toFixed(0)} s`)
