import { appendFileSync } from "node:fs"
import type { CliRenderer, KeyEvent } from "@opentui/core"

/**
 * Latency trace, on with JASKMONEY_TRACE=<file>: one line per key,
 *   key scope handler=<ms> frame=<ms> paint=<ms>
 * handler: the key's synchronous work (handleKey and the reactive updates
 * it sets off); frame: from the key's arrival to its frame on screen;
 * paint: the frame's layout and paint. Frames no key asked for that take
 * longer than 20 ms are logged as "(no key)". Off, it costs nothing.
 */
const file = process.env.JASKMONEY_TRACE
let pending: { key: string; scope: string; at: number; handler: number } | null = null

export const tracing = !!file

/** A start-up milestone: how long after the process started. */
export function traceMark(label: string): void {
  if (file) appendFileSync(file, `mark ${label.padEnd(24)} ${performance.now().toFixed(0)} ms\n`)
}
// When the terminal's bytes arrived: a key's latency starts there, before
// OpenTUI parses it (a lone esc waits out its escape-sequence timeout).
let input = 0
if (file) process.stdin.prependListener("data", () => { input = performance.now() })

export function traceKey(key: KeyEvent, scope: string, run: () => void): void {
  if (!file) { run(); return }
  const start = performance.now()
  const at = start - input < 1000 ? input : start
  run()
  const name = `${key.ctrl ? "ctrl+" : ""}${key.shift && key.name.length > 1 ? "shift+" : ""}${key.name || key.sequence}`
  // Keys faster than frames: the frame answers the first of them. A key
  // still waiting 100 ms on changed nothing on screen.
  if (pending && at - pending.at > 100) {
    appendFileSync(file, `${pending.key.padEnd(12)} ${pending.scope.padEnd(20)} handler=${pending.handler.toFixed(1)} no frame\n`)
    pending = null
  }
  if (!pending) pending = { key: name, scope, at, handler: performance.now() - start }
}

export function traceFrames(renderer: CliRenderer): void {
  if (!file) return
  appendFileSync(file, `# trace ${new Date().toISOString()} ${process.stdout.columns}x${process.stdout.rows}\n`)
  // The renderer's own time for the frame's layout and paint (private:
  // a frame callback would add a yield to every frame).
  const scene = renderer as unknown as { _lastSceneTimeMs?: number }
  let first = true
  renderer.on("frame", () => {
    const now = performance.now()
    if (first) { first = false; appendFileSync(file, `first frame at ${now.toFixed(0)} ms after start\n`) }
    const paint = scene._lastSceneTimeMs ?? 0
    if (pending) {
      appendFileSync(file, `${pending.key.padEnd(12)} ${pending.scope.padEnd(20)} handler=${pending.handler.toFixed(1)} frame=${(now - pending.at).toFixed(1)} paint=${paint.toFixed(1)}\n`)
      pending = null
    } else if (paint > 20) {
      appendFileSync(file, `${"(no key)".padEnd(12)} ${"".padEnd(20)} paint=${paint.toFixed(1)}\n`)
    }
  })
}
