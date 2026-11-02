/**
 * The README's recordings: the setup's tour (--welcome) in a real terminal
 * (scripts/terminal.ts), each demo for exactly one loop of its script, at
 * its own speed, cropped to the demo's pane, as a GIF that loops cleanly
 * (GitHub plays a GIF in a README; an MP4 in the repo it doesn't).
 *
 *   bun run recordings [binary] [--only=chart,filter,ask,suggest]
 *                                    (default: dist/jaskmoney, built first)
 *
 * Headless Chrome draws a terminal this size a few times a second, too
 * slow to film live. So it's recorded, then rendered: while the tour plays,
 * a tap on ttyd's socket keeps every byte the app writes and when; then,
 * with the live output cut off, it's replayed into the same terminal a
 * frame at a time (FRAME_MS of tour time), each photographed once drawn.
 *
 * Needs ffmpeg. Writes docs/screenshots/<demo>.gif, and the same as an
 * MP4 to dist/recordings/<demo>.mp4 (sharper and smaller; GitHub plays
 * one only uploaded through its web editor).
 */
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDb, loadCategories } from "../src/db/client"
import { DEMOS, demoLoopMs, demoWorld, tourTopics } from "../src/state/tour"
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
    let n = 0
    while (window.__at < window.__out.length && window.__out[window.__at][0] <= t) {
      const bytes = window.__out[window.__at++][1]
      await new Promise((done) => term.write(bytes, done))
      n++
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

/** Presses `key` to (re)start a demo; returns when it did, in page time. */
async function start(term: Terminal, key: string): Promise<number> {
  const at = await term.evaluate("performance.now()")
  await term.press(key)
  return at
}

/** Renders one loop of `id`, from `from` (page time), to its GIF. */
async function render(term: Terminal, id: DemoId, from: number): Promise<void> {
  const loopMs = demoLoopMs(id, topics)
  // Where the pane is, from the first of a few moments that shows it
  // whole (a moment can have something drawn over its corners).
  let pane: ReturnType<typeof paneCells> | null = null
  for (const at of [0.2, 0.4, 0.6, 0.8]) {
    await term.evaluate("__restart()")
    await term.evaluate(`__seek(${from + loopMs * at})`)
    try { pane = paneCells(await term.lines()); break } catch {}
  }
  if (!pane) throw new Error(`couldn't find ${id}'s pane:\n${(await term.lines()).join("\n")}`)
  const screen = await term.screen()
  const cellW = screen.width / screen.cols, cellH = screen.height / screen.rows
  // To the pane's border: the cells around it are the tour's backdrop.
  const clip = { x: screen.x + pane.col * cellW, y: screen.y + pane.row * cellH, width: pane.cols * cellW, height: pane.rows * cellH, scale: 1 }

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
  console.log(`${gif} + ${mp4}  ${(loopMs / 1000).toFixed(1)} s, ${frames.length} frames, ${pane.cols}×${pane.rows} cells`)
}

const term = await openTerminal(appBinary(), ["--welcome"], TAP)
try {
  await Bun.sleep(5000)
  // Welcome › Start: the tour, on Charts.
  await term.press("Enter")
  await Bun.sleep(1500)
  // Each → starts the next demo from its beginning; ← back starts Charts.
  const starts: Array<[DemoId, number]> = []
  for (const id of ["filter", "ask", "suggest"] as const) {
    starts.push([id, await start(term, "ArrowRight")])
    await Bun.sleep(demoLoopMs(id, topics) + 500)
  }
  for (let i = 0; i < 2; i++) { await term.press("ArrowLeft"); await Bun.sleep(300) }
  starts.push(["chart", await start(term, "ArrowLeft")])
  await Bun.sleep(demoLoopMs("chart", topics) + 500)

  await term.evaluate("__mute = true")
  const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",")
  for (const [id, from] of starts) if (!only || only.includes(id)) await render(term, id, from)
} finally {
  await term.close()
  rmSync(scratch, { recursive: true, force: true })
}
