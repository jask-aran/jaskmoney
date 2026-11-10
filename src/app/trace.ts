import { appendFileSync } from "node:fs"
import type { CliRenderer, KeyEvent } from "@opentui/core"

const file = process.env.JASKMONEY_TRACE
const write = (line: string) => appendFileSync(file!, line, { mode: 0o600 })
let pending: { key: string; scope: string; at: number; handler: number } | null = null

export function traceMark(label: string): void {
  if (file) write(`mark ${label.padEnd(24)} ${performance.now().toFixed(0)} ms\n`)
}

if (file) {
  let last = performance.now()
  setInterval(() => {
    const now = performance.now()
    if (now - last > 60) write(`stall ${(now - last - 10).toFixed(0).padStart(5)} ms ending at ${now.toFixed(0)} ms\n`)
    last = now
  }, 10).unref()
}
let input = 0
if (file) process.stdin.prependListener("data", () => { input = performance.now() })

export function traceKey(key: KeyEvent, scope: string, run: () => void): void {
  if (!file) { run(); return }
  const start = performance.now()
  const at = start - input < 1000 ? input : start
  run()
  const name = traceKeyName(key)
  if (pending && at - pending.at > 100) {
    write(`${pending.key.padEnd(12)} ${pending.scope.padEnd(20)} handler=${pending.handler.toFixed(1)} no frame\n`)
    pending = null
  }
  if (!pending) pending = { key: name, scope, at, handler: performance.now() - start }
}

export function traceKeyName(key: Pick<KeyEvent, "ctrl" | "meta" | "shift" | "name" | "sequence">): string {
  const named = key.name.length > 1 || key.ctrl || key.meta
  return named ? `${key.ctrl ? "ctrl+" : ""}${key.meta ? "meta+" : ""}${key.shift && key.name.length > 1 ? "shift+" : ""}${key.name}` : "char"
}

export function traceFrames(renderer: CliRenderer): void {
  if (!file) return
  write(`# trace ${new Date().toISOString()} ${process.stdout.columns}x${process.stdout.rows}\n`)
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
