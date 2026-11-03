/**
 * The README's media, made the way asciinema makes a recording: the app
 * in a pseudo-terminal of its own (Bun's), every write kept with its time,
 * as an asciicast; then drawn by agg (asciinema's GIF renderer) in the
 * Nerd Font a terminal would use, and cropped and encoded by ffmpeg.
 *
 * Each app runs in an empty, throwaway JASKMONEY_HOME: nothing of yours is
 * in what it shows. Needs agg (`cargo install --git
 * https://github.com/asciinema/agg`), ffmpeg, and MesloLGS Nerd Font Mono
 * in ~/.local/share/fonts; under WSL, emoji come from Windows' Segoe UI
 * Emoji, as in Windows Terminal.
 */
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

export const COLS = 188, ROWS = 55

/** What a terminal sends for a named key; anything else is sent as is. */
const KEYS: Record<string, string> = { Enter: "\r", Escape: "\x1b", ArrowRight: "\x1b[C", ArrowLeft: "\x1b[D", ArrowUp: "\x1b[A", ArrowDown: "\x1b[B" }

export interface Session {
  /** Ms since the app started. */
  now(): number
  /** When the app first wrote after `after` ms (else `after`). */
  firstWrite(after: number): number
  press(key: string): void
  /** Waits until the app has written `text` (20 s at most). */
  waitFor(text: string): Promise<void>
  /** The screen as text rows, `at` ms in (scripts/cast.ts screenText). */
  screen(at: number): string[]
  /** An asciicast of `from` to `to` ms: everything before as its first
   * event, then each write at its time, `holdMs` later (the first frame
   * held that long). */
  cast(from: number, to: number, holdMs?: number): string
  close(): void
}

/** Starts the app in a COLS × ROWS pseudo-terminal. `settings`: its
 * settings.json, as if already set (Settings › Appearance and the like). */
export function startApp(binary: string, args: string[], settings?: object): Session {
  const home = mkdtempSync(join(tmpdir(), "jaskmoney-cast-"))
  if (settings) writeFileSync(join(home, "settings.json"), JSON.stringify({ version: 2, ...settings }))
  const writes: Array<{ at: number; text: string }> = []
  const decoder = new TextDecoder()
  const started = performance.now()
  const proc = Bun.spawn([binary, ...args], {
    env: { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor", JASKMONEY_HOME: home, JASKMONEY_NO_UPDATE_CHECK: "1" },
    terminal: { cols: COLS, rows: ROWS, data: (_, bytes) => writes.push({ at: performance.now() - started, text: decoder.decode(bytes, { stream: true }) }) },
  })
  const upTo = (at: number) => writes.filter((w) => w.at <= at).map((w) => w.text).join("")
  return {
    now: () => performance.now() - started,
    firstWrite: (after) => writes.find((w) => w.at > after)?.at ?? after,
    press: (key) => proc.terminal!.write(KEYS[key] ?? key),
    async waitFor(text) {
      for (let i = 0; i < 200; i++) {
        if (writes.some((w) => w.text.includes(text))) return
        await Bun.sleep(100)
      }
      throw new Error(`the app never wrote "${text}"`)
    },
    screen: (at) => screenText(upTo(at)),
    cast(from, to, holdMs = 0) {
      const events = writes.filter((w) => w.at > from && w.at < to).map((w) => JSON.stringify([+((w.at - from + holdMs) / 1000).toFixed(4), "o", w.text]))
      return [JSON.stringify({ version: 2, width: COLS, height: ROWS }), JSON.stringify([0, "o", upTo(from)]), ...events].join("\n") + "\n"
    },
    close() {
      proc.kill()
      rmSync(home, { recursive: true, force: true })
    },
  }
}

/** The screen a stream of writes leaves, as text: enough of a terminal for
 * finding boxes. The app places every run of text with a cursor move
 * (CSI row;col H); other sequences don't change what's shown. */
export function screenText(stream: string): string[] {
  const grid = Array.from({ length: ROWS }, () => Array<string>(COLS).fill(" "))
  let row = 0, col = 0
  const tokens = /\x1b\[(\d+);(\d+)H|\x1b\[2J|\x1b\[[0-9;?<>=]*[ -\/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[P^_][\s\S]*?\x1b\\|\x1b.|([^\x1b]+)/g
  for (const m of stream.matchAll(tokens)) {
    if (m[1]) { row = Number(m[1]) - 1; col = Number(m[2]) - 1 }
    else if (m[0] === "\x1b[2J") for (const line of grid) line.fill(" ")
    else if (m[3]) for (const ch of m[3]) {
      if (ch === "\r" || ch === "\n" || ch === "️") continue
      if (row < ROWS && col < COLS) grid[row]![col] = ch
      col++
    }
  }
  return grid.map((line) => line.join(""))
}

// ---- Drawing, cropping and encoding.

/** agg's cell at FONT_SIZE: MesloLGS's advance (0.602 em) by its line
 * height (1.262 em: a terminal's row, what Windows Terminal draws). */
const FONT_SIZE = 26, CELL_W = FONT_SIZE * 0.60205, CELL_H = FONT_SIZE * 1.262

/** The fonts agg is given: MesloLGS, DejaVu Sans Mono for what it lacks
 * (braille: the line charts), and an emoji font. */
function fontArgs(scratch: string): string[] {
  const emoji = "/mnt/c/Windows/Fonts/seguiemj.ttf"
  const dirs = [join(homedir(), ".local/share/fonts/meslo"), "/usr/share/fonts/truetype/dejavu"]
  if (existsSync(emoji)) {
    // Its own folder: agg reads every font in one it's given.
    mkdirSync(join(scratch, "emoji"), { recursive: true })
    copyFileSync(emoji, join(scratch, "emoji", "seguiemj.ttf"))
    dirs.push(join(scratch, "emoji"))
  }
  return [
    ...dirs.flatMap((dir) => ["--font-dir", dir]),
    "--text-font-family", "MesloLGS Nerd Font Mono,DejaVu Sans Mono",
    ...(existsSync(emoji) ? ["--emoji-font-family", "Segoe UI Emoji"] : []),
    "--font-size", String(FONT_SIZE), "--line-height", "1.262",
  ]
}

/** A cell rectangle of the screen, in cells. */
export interface Cells { col: number; row: number; cols: number; rows: number }

/** Heavy steps (agg, ffmpeg) two at a time: each uses several cores, and
 * full-screen encodes at once are more memory than WSL has (it ran out,
 * 2026-11-02). */
const LANES = 2
let running = 0
const queue: Array<() => void> = []
async function heavy(args: string[]): Promise<void> {
  if (running >= LANES) await new Promise<void>((go) => queue.push(go))
  running++
  try {
    const proc = Bun.spawn(args, { stdout: "ignore", stderr: "pipe" })
    const code = await proc.exited
    if (code !== 0) throw new Error(`${args[0]} failed: ${await new Response(proc.stderr).text()}`)
  } finally {
    running--
    queue.shift()?.()
  }
}

/** A GIF's frame rate: 25 fps is 4 cs a frame, which a GIF's delays (whole
 * centiseconds) hold exactly; browsers play it smoothly at GIF_WIDTH. */
const GIF_FPS = 25

/** Draws `cast` (`loopMs` long) with agg, cropped to `crop` (else the
 * whole screen), to an .mp4 (agg's frames: every one the app drew, 20 ms
 * at least), a .gif (GIF_FPS, `gifWidth` px wide: the README's column at
 * twice its size, for sharp text on high-density screens) or a .png of its
 * last frame. */
export async function draw(cast: string, loopMs: number, outputs: { mp4?: string; gif?: string; gifWidth?: number; png?: string }, crop?: Cells): Promise<void> {
  const scratch = mkdtempSync(join(tmpdir(), "jaskmoney-draw-"))
  try {
    // agg draws the emoji presentation selector (U+FE0F) as a box of its
    // own; a space keeps the two cells the app gave the emoji.
    writeFileSync(join(scratch, "in.cast"), cast.replaceAll("\\ufe0f", " ").replaceAll("️", " "))
    const lastEvent = Math.max(0, ...cast.trim().split("\n").slice(1).map((line) => JSON.parse(line)[0] as number))
    const drawn = join(scratch, "drawn.gif")
    await heavy(["agg", ...fontArgs(scratch), "--fps-cap", "100", "--idle-time-limit", String(loopMs / 1000 + 1),
      "--last-frame-duration", Math.max(0.02, loopMs / 1000 - lastEvent).toFixed(3), join(scratch, "in.cast"), drawn])
    // The crop, in pixels: agg centres the cells in its padding.
    const [width, height] = (await new Response(Bun.spawn(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", drawn]).stdout).text()).trim().split(",").map(Number)
    const x0 = (width! - COLS * CELL_W) / 2, y0 = (height! - ROWS * CELL_H) / 2
    const cut = crop
      ? `crop=${Math.round(crop.cols * CELL_W)}:${Math.round(crop.rows * CELL_H)}:${Math.round(x0 + crop.col * CELL_W)}:${Math.round(y0 + crop.row * CELL_H)}`
      : "null"
    const input = ["ffmpeg", "-y", "-loglevel", "error", "-i", drawn]
    if (outputs.mp4) await heavy([...input, "-vf", `${cut},pad=ceil(iw/2)*2:ceil(ih/2)*2,fps=50`, "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-tune", "animation", "-pix_fmt", "yuv420p", "-movflags", "+faststart", outputs.mp4])
    if (outputs.gif) {
      // Two passes, the palette first: one pass (split, palettegen) holds
      // every frame in memory (WSL ran out, 2026-11-02).
      const frames = `${cut},fps=${GIF_FPS},scale=${outputs.gifWidth ?? 1600}:-2:flags=lanczos`
      const palette = join(scratch, "palette.png")
      await heavy([...input, "-vf", `${frames},palettegen=max_colors=256:stats_mode=diff`, palette])
      await heavy([...input, "-i", palette, "-lavfi", `${frames}[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`, "-loop", "0", outputs.gif])
    }
    if (outputs.png) await heavy([...input, "-vf", `${cut}`, "-update", "1", outputs.png])
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** The app binary: the one named, or dist/jaskmoney built now. */
export function appBinary(): string {
  if (process.argv[2] && !process.argv[2].startsWith("--")) return process.argv[2]
  if (Bun.spawnSync(["bun", "run", "build"], { stdout: "inherit", stderr: "inherit" }).exitCode !== 0) process.exit(1)
  return "dist/jaskmoney"
}
