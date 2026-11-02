/**
 * A real terminal to photograph the app in, for the README's screenshots
 * and recordings: the app in xterm.js (served by ttyd) in headless Chrome
 * at twice the pixel density, with the Nerd Font a terminal would use.
 * xterm.js draws box-drawing and block characters itself, so lines join
 * without gaps.
 *
 * The app runs in an empty, throwaway JASKMONEY_HOME: nothing of yours is
 * in what it shows.
 *
 * Under WSL it uses Windows' Chrome, in a window of its own: it draws
 * with the GPU, where WSL's headless Chrome draws in software, a second or
 * more a frame. WSL's networking must be mirrored (127.0.0.1 both ways),
 * and the font installed in Windows. Elsewhere: google-chrome, headless,
 * the font installed for fontconfig (~/.local/share/fonts). And ttyd.
 */
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/** MesloLGS ("small" line gap), as a terminal would set it: MesloLGL's
 * taller lines stretch everything drawn in cells (the Up logo). */
export const FONT = "MesloLGS Nerd Font Mono"
/** CSS pixels and density: about 180×55 cells, written at 2×. */
export const WIDTH = 1440, HEIGHT = 900, SCALE = 2, FONT_SIZE = 13
/** Windows' Chrome, from WSL. */
const WINDOWS_CHROME = "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"
// Ports of its own, so several can run at once.
const TTYD_PORT = 20000 + (process.pid % 20000), CDP_PORT = TTYD_PORT + 1

export interface Terminal {
  send(method: string, params?: object): Promise<any>
  /** Types each character of `keys`, or one named key ("Enter", "ArrowRight"). */
  press(key: string): Promise<void>
  type(keys: string): Promise<void>
  /** The terminal's cells on the page, in CSS pixels, and one cell's size. */
  screen(): Promise<{ x: number; y: number; width: number; height: number; cols: number; rows: number }>
  /** Runs `expression` in the page (awaiting a promise), returning its value. */
  evaluate(expression: string): Promise<any>
  /** The terminal's text, row by row. */
  lines(): Promise<string[]>
  close(): Promise<void>
}

const KEY_CODES: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  Escape: { code: "Escape", keyCode: 27 },
}

/** `beforeLoad`: a script the page runs before ttyd's own (to tap its
 * socket: scripts/recordings.ts). */
export async function openTerminal(binary: string, args: string[], beforeLoad?: string): Promise<Terminal> {
  const windows = existsSync(WINDOWS_CHROME)
  // Chrome's profile, on its own side.
  const profile = mkdtempSync(join(windows ? "/mnt/c/Users/Public" : tmpdir(), "jaskmoney-shots-"))
  const home = mkdtempSync(join(tmpdir(), "jaskmoney-shots-home-"))
  const ttyd = spawn("ttyd", [
    "-W", "-p", String(TTYD_PORT), "-i", "127.0.0.1",
    "-t", `fontFamily=${FONT}`, "-t", `fontSize=${FONT_SIZE}`, "-t", "lineHeight=1", "-t", "letterSpacing=0",
    "-t", "rendererType=webgl", "-t", "disableLeaveAlert=true", "-t", "disableResizeOverlay=true",
    binary, ...args,
  ], { stdio: "ignore", env: { ...process.env, JASKMONEY_HOME: home, JASKMONEY_NO_UPDATE_CHECK: "1" } })
  const chrome = spawn(windows ? WINDOWS_CHROME : "google-chrome", [
    ...(windows
      // A window of its own, with nothing slowing it when it's covered.
      ? ["--new-window", "--no-first-run", "--no-default-browser-check", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling"]
      : ["--headless=new"]),
    `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${windows ? spawnSync("wslpath", ["-w", profile]).stdout.toString().trim() : profile}`,
    `--window-size=${WIDTH + 40},${HEIGHT + 160}`, `--force-device-scale-factor=${SCALE}`, "--hide-scrollbars", "about:blank",
  ], { stdio: "ignore" })
  let browserClose = async () => {}
  const close = async () => {
    await browserClose()
    ttyd.kill(); chrome.kill()
    await Bun.sleep(windows ? 1500 : 0)
    for (const dir of [profile, home]) try { rmSync(dir, { recursive: true, force: true }) } catch {}
  }

  try {
    let pages: Array<{ type: string; webSocketDebuggerUrl: string }> = []
    for (let i = 0; i < 50 && !pages.some((p) => p.type === "page"); i++) {
      await Bun.sleep(200)
      pages = await fetch(`http://127.0.0.1:${CDP_PORT}/json`).then((r) => r.json(), () => [])
    }
    // Closing Chrome is asked of it: under WSL, ending the process that
    // started it leaves Windows' Chrome running.
    browserClose = async () => {
      const { webSocketDebuggerUrl } = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`).then((r) => r.json(), () => ({}))
      if (!webSocketDebuggerUrl) return
      const browser = new WebSocket(webSocketDebuggerUrl)
      await new Promise((resolve) => { browser.addEventListener("open", resolve, { once: true }); browser.addEventListener("error", resolve, { once: true }) })
      try { browser.send(JSON.stringify({ id: 1, method: "Browser.close" })) } catch {}
      await Bun.sleep(300)
    }
    const ws = new WebSocket(pages.find((p) => p.type === "page")!.webSocketDebuggerUrl)
    await new Promise((resolve) => ws.addEventListener("open", resolve, { once: true }))
    let id = 0
    const waiting = new Map<number, (result: any) => void>()
    const listeners: Array<(message: any) => void> = []
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data))
      if (message.id) waiting.get(message.id)?.(message.result)
      else for (const listen of listeners) listen(message)
    })
    const send = (method: string, params: object = {}) => new Promise<any>((resolve) => {
      waiting.set(++id, resolve)
      ws.send(JSON.stringify({ id, method, params }))
    })
    const evaluate = async (expression: string) => {
      const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
      if (reply.exceptionDetails) throw new Error(`in the page: ${reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text}`)
      return reply.result.value
    }
    const press = async (key: string) => {
      const named = KEY_CODES[key]
      const text = named ? named.text : key
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code: named?.code, windowsVirtualKeyCode: named?.keyCode, ...(text ? { text } : {}) })
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code: named?.code, windowsVirtualKeyCode: named?.keyCode })
    }
    await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: SCALE, mobile: false })
    await send("Page.enable")
    if (beforeLoad) await send("Page.addScriptToEvaluateOnNewDocument", { source: beforeLoad })
    await send("Page.navigate", { url: `http://127.0.0.1:${TTYD_PORT}` })
    return {
      send: Object.assign(send, { on: (listen: (message: any) => void) => listeners.push(listen) }),
      press,
      evaluate,
      type: async (keys) => { for (const key of keys) await press(key) },
      screen: async () => JSON.parse(await evaluate(`JSON.stringify({ ...document.querySelector('.xterm-screen').getBoundingClientRect().toJSON(), cols: term.cols, rows: term.rows })`)),
      lines: async () => JSON.parse(await evaluate(`JSON.stringify(Array.from({ length: term.rows }, (_, r) => term.buffer.active.getLine(term.buffer.active.viewportY + r).translateToString(true)))`)),
      close: async () => { ws.close(); await close() },
    }
  } catch (error) {
    await close()
    throw error
  }
}

/** The app binary: the one named, or dist/jaskmoney built now. */
export function appBinary(): string {
  if (process.argv[2] && !process.argv[2].startsWith("--")) return process.argv[2]
  if (Bun.spawnSync(["bun", "run", "build"], { stdout: "inherit", stderr: "inherit" }).exitCode !== 0) process.exit(1)
  return "dist/jaskmoney"
}
