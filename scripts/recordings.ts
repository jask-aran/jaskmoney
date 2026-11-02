/**
 * The README's recordings in a real terminal (scripts/terminal.ts): the
 * Overview through its charts (the hero), and the setup's tour (--welcome),
 * each demo for exactly one loop of its script, at its own speed, cropped
 * to the demo's pane; each a GIF that loops cleanly
 * (GitHub plays a GIF in a README; an MP4 in the repo it doesn't).
 *
 *   bun run recordings [binary] [--only=overview,filter,ask,suggest,chart]
 *                                    (default: dist/jaskmoney, built first)
 *
 * Chrome can't photograph a terminal this size as fast as it changes, so
 * each demo is recorded, then rendered: while it plays, a tap on ttyd's
 * socket keeps every byte the app writes and when; then, with the live
 * output cut off, they're replayed into the same terminal a frame at a
 * time (FRAME_MS of tour time), each photographed once drawn. Each demo
 * has its own app, terminal and Chrome, all at once: the whole takes about
 * the longest demo's loop and its rendering.
 *
 * Needs ffmpeg. Writes docs/screenshots/<scene>.gif, and the same as an
 * MP4 to dist/recordings/<scene>.mp4 (sharper and smaller; GitHub plays
 * one only uploaded through its web editor).
 */
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDb, loadCategories } from "../src/db/client"
import { CHART_VIEW_MS, DEMOS, demoLoopMs, demoWorld, tourTopics } from "../src/state/tour"
import { CHART_VIEWS } from "../src/state/uiStore"
import { appBinary, openTerminal, type Terminal } from "./terminal"

type DemoId = (typeof DEMOS)[number]["id"]
const FRAME_MS = 40

// The tour's world, as a new install's categories make it, for how long
// each demo's script runs (the Smart search's depends on its words).
const scratch = mkdtempSync(join(tmpdir(), "jaskmoney-rec-"))
const db = openDb(join(scratch, "rec.db"))
const topics = tourTopics(demoWorld(loadCategories(db)))
db.close()

/** ttyd's socket, tapped: output messages ("0" and the bytes) kept with
 * their time in __out; with __mute set, none reach the terminal and
 * nothing is sent back. __seek(t) writes what was kept up to t and waits
 * for it to be drawn; it says how many writes that was. */
const TAP = `(() => {
  const Real = window.WebSocket
  window.__out = []; window.__mute = false; window.__at = 0
  window.WebSocket = function (url, protocols) {
    const ws = new Real(url, protocols)
    let handler = null
    Object.defineProperty(ws, "onmessage", { set(h) { handler = h }, get() { return handler } })
    Real.prototype.addEventListener.call(ws, "message", (event) => {
      const d = event.data
      if (d instanceof ArrayBuffer && new Uint8Array(d)[0] === 48) window.__out.push([performance.now(), new Uint8Array(d.slice(1))])
      if (!window.__mute && handler) handler.call(ws, event)
    })
    // ttyd listens with addEventListener: its listeners are muted too.
    const listen = ws.addEventListener.bind(ws)
    ws.addEventListener = (type, fn, options) => listen(type, type === "message" ? (event) => { if (!window.__mute) fn.call(ws, event) } : fn, options)
    const send = ws.send.bind(ws)
    ws.send = (d) => { if (!window.__mute) send(d) }
    return ws
  }
  window.WebSocket.prototype = Real.prototype
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
  window.__restart = () => { term.reset(); term.clearTextureAtlas(); window.__at = 0 }
  window.__seek = async (t) => {
    const chunks = []
    while (window.__at < window.__out.length && window.__out[window.__at][0] <= t) chunks.push(window.__out[window.__at++][1])
    const n = chunks.length
    if (n) {
      // One write of them all.
      const bytes = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0))
      let at = 0
      for (const c of chunks) { bytes.set(c, at); at += c.length }
      await new Promise((done) => term.write(bytes, done))
    }
    // Every row repainted: the renderer otherwise redraws only the cells
    // it believes changed, and after a reset some keep their old pixels.
    if (n) { term.refresh(0, term.rows - 1); await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))) }
    return n
  }
})()`

/** The demo's pane: the box the tour draws below its card, from its
 * corners in the terminal's text, in cells. */
function paneCells(lines: string[]): { col: number; row: number; cols: number; rows: number } {
  const cardEnd = lines.findIndex((l) => l.includes("╰"))
  const top = lines.findIndex((l, r) => r > cardEnd && l.includes("╭"))
  const col = top < 0 ? -1 : lines[top]!.indexOf("╭")
  const right = top < 0 ? -1 : lines[top]!.indexOf("╮", col)
  const bottom = lines.findIndex((l, r) => r > top && l[col] === "╰")
  if (top < 0 || right < 0 || bottom < 0) throw new Error("couldn't find the demo's pane")
  return { col, row: top, cols: right - col + 1, rows: bottom - top + 1 }
}

/** Waits until `ready` is true of the terminal's text (or 20 s); before
 * ttyd's page has made its terminal, there's none. */
async function until(term: Terminal, ready: (lines: string[]) => boolean): Promise<void> {
  for (let i = 0; i < 100; i++) {
    if (ready(await term.lines().catch(() => []))) return
    await Bun.sleep(200)
  }
  throw new Error("the app didn't come up")
}

/** What's filmed: how to bring it up, how long a loop is, what's played
 * through it, and whether it's cropped to the tour's demo pane. */
interface Scene {
  id: string
  args: string[]
  loopMs: number
  /** Brings it to just before its loop; resolves with the key that starts
   * it (pressed as the loop begins). */
  setup(term: Terminal): Promise<string>
  /** Keys pressed `at` ms into the loop. */
  keys?: Array<{ at: number; key: string }>
  pane: boolean
  /** Its settings.json (scripts/terminal.ts). */
  settings?: object
}

/** A tour demo: Welcome › Start, then → to it (each → starts the next
 * demo from its beginning); Charts, the first, starts again with ←. */
const tourDemo = (id: DemoId): Scene => ({
  id, args: ["--welcome"], loopMs: demoLoopMs(id, topics), pane: true,
  async setup(term) {
    await until(term, (lines) => lines.some((l) => l.includes("Skip setup")))
    await term.press("Enter")
    await until(term, (lines) => lines.some((l) => l.includes("Tour ·")))
    const keys = id === "chart" ? ["ArrowRight", "ArrowLeft"] : DEMOS.slice(1, DEMOS.findIndex((d) => d.id === id) + 1).map(() => "ArrowRight")
    for (const key of keys.slice(0, -1)) { await term.press(key); await Bun.sleep(150) }
    return keys.at(-1)!
  },
})

/** The README's hero: the Overview on the demo data, its top chart
 * through every view at the tour's pace (l), each drawing in as it does in
 * the tour (chart motion "always"; a new install draws in once). It starts
 * a view back, so the loop ends on the switch it begins with. */
const overview: Scene = {
  id: "overview", args: ["--demo"], loopMs: CHART_VIEW_MS * CHART_VIEWS.length, pane: false,
  settings: { ui: { chartMotion: "always" } },
  keys: Array.from({ length: CHART_VIEWS.length - 1 }, (_, k) => ({ at: (k + 1) * CHART_VIEW_MS, key: "l" })),
  async setup(term) {
    await until(term, (lines) => lines.some((l) => l.includes("Demo mode")))
    await term.press("h")
    await Bun.sleep(CHART_VIEW_MS)
    return "l"
  },
}

const SCENES: Scene[] = [overview, tourDemo("filter"), tourDemo("ask"), tourDemo("suggest"), tourDemo("chart")]

/** Films `scene` in a terminal of its own: brought up, one loop recorded,
 * then rendered. */
async function film(binary: string, scene: Scene): Promise<void> {
  const term = await openTerminal(binary, scene.args, { beforeLoad: TAP, settings: scene.settings })
  try {
    const key = await scene.setup(term)
    const from = await term.evaluate("performance.now()")
    await term.press(key)
    const now = async () => (await term.evaluate("performance.now()")) - from
    // Its keys on time, and (for a demo) where its pane is, from the live
    // screen as soon as it shows whole.
    let pane: ReturnType<typeof paneCells> | null = null
    for (const { at, key } of scene.keys ?? []) {
      if (scene.pane && !pane) try { pane = paneCells(await term.lines()) } catch {}
      const wait = at - (await now())
      if (wait > 0) await Bun.sleep(wait)
      await term.press(key)
    }
    while (scene.pane && !pane && (await now()) < scene.loopMs) {
      await Bun.sleep(300)
      try { pane = paneCells(await term.lines()) } catch {}
    }
    if (scene.pane && !pane) throw new Error(`couldn't find ${scene.id}'s pane:\n${(await term.lines()).join("\n")}`)
    const left = scene.loopMs + 200 - (await now())
    if (left > 0) await Bun.sleep(left)
    await term.evaluate("__mute = true")
    await render(term, scene, from, pane)
  } finally {
    await term.close()
  }
}

/** Renders one loop of `scene`, from `from` (page time), to its GIF and
 * MP4: the whole terminal, or just the demo's pane. */
async function render(term: Terminal, scene: Scene, from: number, pane: ReturnType<typeof paneCells> | null): Promise<void> {
  const { id, loopMs } = scene
  const screen = await term.screen()
  const cellW = screen.width / screen.cols, cellH = screen.height / screen.rows
  // To the pane's border: the cells around it are the tour's backdrop.
  const clip = pane
    ? { x: screen.x + pane.col * cellW, y: screen.y + pane.row * cellH, width: pane.cols * cellW, height: pane.rows * cellH, scale: 1 }
    : { x: screen.x, y: screen.y, width: screen.width, height: screen.height, scale: 1 }

  await term.evaluate("__restart()")
  await term.evaluate(`__seek(${from})`)
  const dir = mkdtempSync(join(tmpdir(), `jaskmoney-rec-${id}-`))
  // Each distinct frame, held for as long as nothing changes.
  const frames: Array<{ file: string; ms: number }> = []
  let last = ""
  for (let t = 0; t < loopMs; t += FRAME_MS) {
    const writes = await term.evaluate(`__seek(${from + t})`)
    if (frames.length && !writes) { frames.at(-1)!.ms += FRAME_MS; continue }
    const { data } = await term.send("Page.captureScreenshot", { format: "png", clip, optimizeForSpeed: true })
    const hash = createHash("sha1").update(data).digest("hex")
    if (hash === last) { frames.at(-1)!.ms += FRAME_MS; continue }
    last = hash
    const file = join(dir, `${String(frames.length).padStart(5, "0")}.png`)
    writeFileSync(file, Buffer.from(data, "base64"))
    frames.push({ file, ms: FRAME_MS })
  }
  writeFileSync(join(dir, "list.txt"), [...frames.flatMap((f) => [`file '${f.file}'`, `duration ${(f.ms / 1000).toFixed(3)}`]), `file '${frames.at(-1)!.file}'`].join("\n"))

  const gif = `docs/screenshots/${id}.gif`, mp4 = `dist/recordings/${id}.mp4`
  mkdirSync("dist/recordings", { recursive: true })
  const input = ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "list.txt")]
  const runs = [
    ["ffmpeg", ...input, "-filter_complex", "split[a][b];[a]palettegen=stats_mode=full:max_colors=128[p];[b][p]paletteuse=dither=none", "-fps_mode", "vfr", "-loop", "0", gif],
    ["ffmpeg", ...input, "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=25", "-c:v", "libx264", "-crf", "16", "-preset", "slow", "-tune", "animation", "-pix_fmt", "yuv420p", "-movflags", "+faststart", mp4],
  ].map((args) => Bun.spawn(args, { stderr: "inherit" }))
  const codes = await Promise.all(runs.map((run) => run.exited))
  rmSync(dir, { recursive: true, force: true })
  if (codes.some((code) => code !== 0)) throw new Error(`ffmpeg failed for ${id}`)
  console.log(`${gif} + ${mp4}  ${(loopMs / 1000).toFixed(1)} s, ${frames.length} frames${pane ? `, ${pane.cols}×${pane.rows} cells` : ""}`)
}

const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",")
const binary = appBinary()
const started = Date.now()
try {
  await Promise.all(SCENES.filter((scene) => !only || only.includes(scene.id)).map((scene) => film(binary, scene)))
  console.log(`${((Date.now() - started) / 1000).toFixed(0)} s`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
