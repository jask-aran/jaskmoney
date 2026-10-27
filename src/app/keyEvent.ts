import type { KeyEvent } from "@opentui/core"

/** A key press as the terminal reports it: a single character, and space,
 * carry their text as `sequence` (" " for space); named keys (return,
 * escape, left, ...) carry none. Shifted letters need an explicit
 * `sequence` (e.g. `keyEvent("g", { shift: true, sequence: "G" })`). Used by
 * the command palette to press a hint's key, and by tests. */
export function keyEvent(name: string, overrides: Partial<KeyEvent> = {}): KeyEvent {
  const sequence = overrides.sequence ?? (name === "space" ? " " : name.length === 1 ? name : "")
  return {
    name, ctrl: false, meta: false, shift: false, option: false, sequence, number: false, raw: sequence,
    eventType: "press", source: "raw",
    preventDefault() {}, stopPropagation() {}, defaultPrevented: false, propagationStopped: false,
    ...overrides,
  } as KeyEvent
}
