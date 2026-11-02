import { appendFileSync } from "node:fs"
import type { CliRenderer, KeyEvent } from "@opentui/core"

/**
 * Latency trace, on with JASKMONEY_TRACE=<file>: one line per key,
 *   key scope handler=<ms> frame=<ms> paint=<ms>
 * handler: the key's synchronous work (handleKey and the reactive updates
 * it sets off); frame: from the key's arrival to its frame on screen;
 * paint: the frame's layout and paint. Frames no key asked for that take
 * longer than 20 ms are logged as "(no key)", and any 50 ms or more the
 * main thread was busy (a sync's write, a reload) as "stall". Off, it
 * costs nothing.
 */
const file = process.env.JASKMONEY_TRACE
/** A line to the trace, which only its owner can read (created 0600). */
const write = (line: string) => appendFileSync(file!, line, { mode: 0o600 })
let pending: { key: string; scope: string; at: number; handler: number } | null = null

export const tracing = !!file

/** A milestone (start-up, a sync's stages): how long after the process started. */
export function traceMark(label: string): void {
  if (file) write(`mark ${label.padEnd(24)} ${performance.now().toFixed(0)} ms\n`)
}

// Stalls: a timer every 10 ms that comes late by more than 50 ms means
// the main thread was busy that long (keys and frames waited too), logged
//   stall <ms> ending at <ms after start>
if (file) {
  let last = performance.now()
  setInterval(() => {
    const now = performance.now()
    if (now - last > 60) write(`stall ${(now - last - 10).toFixed(0).padStart(5)} ms ending at ${now.toFixed(0)} ms\n`)
    last = now
  }, 10).unref()
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
  const name = traceKeyName(key)
  // Keys faster than frames: the frame answers the first of them. A key
  // still waiting 100 ms on changed nothing on screen.
  if (pending && at - pending.at > 100) {
    write(`${pending.key.padEnd(12)} ${pending.scope.padEnd(20)} handler=${pending.handler.toFixed(1)} no frame\n`)
    pending = null
  }
  if (!pending) pending = { key: name, scope, at, handler: performance.now() - start }
}

/** A key as the trace names it: named keys (return, up, ctrl+k) as
 * themselves, a printable character only as "char", so text typed into a
 * field (a token, a note) never reaches the file. */
export function traceKeyName(key: Pick<KeyEvent, "ctrl" | "meta" | "shift" | "name" | "sequence">): string {
  const named = key.name.length > 1 || key.ctrl || key.meta
  return named ? `${key.ctrl ? "ctrl+" : ""}${key.meta ? "meta+" : ""}${key.shift && key.name.length > 1 ? "shift+" : ""}${key.name}` : "char"
}

export function traceFrames(renderer: CliRenderer): void {
  if (!file) return
  write(`# trace ${new Date().toISOString()} ${process.stdout.columns}x${process.stdout.rows}\n`)
  // The renderer's own time for the frame's layout and paint, read on its
  // "frame" event (a frame callback would add a yield to every frame).
  let first = true
  renderer.on("frame", () => {
    const now = performance.now()
    if (first) { first = false; write(`first frame at ${now.toFixed(0)} ms after start\n`) }
    const paint = renderer.lastSceneTimeMs ?? 0
    if (pending) {
      write(`${pending.key.padEnd(12)} ${pending.scope.padEnd(20)} handler=${pending.handler.toFixed(1)} frame=${(now - pending.at).toFixed(1)} paint=${paint.toFixed(1)}\n`)
      pending = null
    } else if (paint > 20) {
      write(`${"(no key)".padEnd(12)} ${"".padEnd(20)} paint=${paint.toFixed(1)}\n`)
    }
  })
}
