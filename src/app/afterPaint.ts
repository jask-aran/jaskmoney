import type { CliRenderer } from "@opentui/core"

/**
 * Run `fn` once the frame the current key asked for is on screen: work a
 * key sets off but its frame doesn't need (background suggesting, lookups)
 * waits for it rather than holding it up. Without a renderer (tests), or
 * if no frame comes within 50 ms, it runs on a timer.
 */
export function afterPaint(fn: () => void): void {
  let done = false
  const run = () => { if (!done) { done = true; fn() } }
  renderer?.once("frame", () => setTimeout(run, 0))
  setTimeout(run, renderer ? 50 : 0)
}

let renderer: CliRenderer | null = null

/** App start: frames come from this renderer. Returns the undo. */
export function paintWith(r: CliRenderer): () => void {
  renderer = r
  return () => { if (renderer === r) renderer = null }
}
