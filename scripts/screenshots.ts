/**
 * The README's screenshots, as a real terminal draws them: the built app
 * (`--demo`, made-up data) in xterm.js, served by ttyd, in headless Chrome
 * at twice the pixel density, with a Nerd Font. xterm.js draws box-drawing
 * and block characters itself, so lines join without gaps.
 *
 *   bun run screenshots [binary]      (default: dist/jaskmoney, built first)
 *
 * It runs in an empty, throwaway JASKMONEY_HOME: the demo is made from
 * your own history when there is one, and these images are published.
 *
 * Needs ttyd, google-chrome and the font (FONT below) installed for
 * fontconfig (~/.local/share/fonts). Writes docs/screenshots/*.png.
 */
import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const FONT = "MesloLGL Nerd Font Mono"
/** CSS pixels and density: about 180×52 cells, written at 2×. */
const WIDTH = 1440, HEIGHT = 900, SCALE = 2, FONT_SIZE = 13
const TTYD_PORT = 7781, CDP_PORT = 9341
/** Each shot: the keys that bring it up, and its file. Charts draw in at
 * launch; each waits for them. */
const SHOTS = [
  { file: "overview.png", keys: "1" },
  { file: "transactions.png", keys: "2" },
  { file: "budgets.png", keys: "3" },
  { file: "settings.png", keys: "4" },
]

const binary = process.argv[2] ?? (spawnSync("bun", ["run", "build"], { stdio: "inherit" }).status === 0 ? "dist/jaskmoney" : null)
if (!binary) process.exit(1)

const profile = mkdtempSync(join(tmpdir(), "jaskmoney-shots-"))
const home = mkdtempSync(join(tmpdir(), "jaskmoney-shots-home-"))
const ttyd = spawn("ttyd", [
  "-W", "-p", String(TTYD_PORT), "-i", "127.0.0.1",
  "-t", `fontFamily=${FONT}`, "-t", `fontSize=${FONT_SIZE}`, "-t", "lineHeight=1", "-t", "letterSpacing=0",
  "-t", "rendererType=webgl", "-t", "disableLeaveAlert=true", "-t", "disableResizeOverlay=true",
  binary, "--demo",
], { stdio: "ignore", env: { ...process.env, JASKMONEY_HOME: home, JASKMONEY_NO_UPDATE_CHECK: "1" } })
const chrome = spawn("google-chrome", [
  "--headless=new", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${WIDTH},${HEIGHT}`, `--force-device-scale-factor=${SCALE}`, "--hide-scrollbars", "about:blank",
], { stdio: "ignore" })
const stop = () => { ttyd.kill(); chrome.kill(); for (const dir of [profile, home]) rmSync(dir, { recursive: true, force: true }) }

try {
  let pages: Array<{ type: string; webSocketDebuggerUrl: string }> = []
  for (let i = 0; i < 50 && !pages.some((p) => p.type === "page"); i++) {
    await Bun.sleep(200)
    pages = await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json(), () => [])
  }
  const ws = new WebSocket(pages.find((p) => p.type === "page")!.webSocketDebuggerUrl)
  await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }))
  let id = 0
  const waiting = new Map<number, (result: any) => void>()
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data))
    waiting.get(message.id)?.(message.result)
  })
  const send = (method: string, params: object = {}) => new Promise<any>((resolve) => {
    waiting.set(++id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })
  await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false })
  await send("Page.navigate", { url: `http://127.0.0.1:${TTYD_PORT}` })
  // The app starts, loads the demo and draws its charts in.
  await Bun.sleep(6000)
  for (const shot of SHOTS) {
    for (const key of shot.keys) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, text: key })
      await send("Input.dispatchKeyEvent", { type: "keyUp", key })
    }
    await Bun.sleep(2500)
    // Just the terminal's cells: the page around them isn't the app.
    const { result } = await send("Runtime.evaluate", { expression: "JSON.stringify(document.querySelector('.xterm-screen').getBoundingClientRect())", returnByValue: true })
    const box = JSON.parse(result.value)
    const { data } = await send("Page.captureScreenshot", { format: "png", clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 } })
    writeFileSync(join("docs/screenshots", shot.file), Buffer.from(data, "base64"))
    console.log(`docs/screenshots/${shot.file}`)
  }
  ws.close()
} finally {
  stop()
}
