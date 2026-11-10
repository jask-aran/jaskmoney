import type { KeyEvent } from "@opentui/core"

export function keyEvent(name: string, overrides: Partial<KeyEvent> = {}): KeyEvent {
  const sequence = overrides.sequence ?? (name === "space" ? " " : name.length === 1 ? name : "")
  return {
    name, ctrl: false, meta: false, shift: false, option: false, sequence, number: false, raw: sequence,
    eventType: "press", source: "raw",
    preventDefault() {}, stopPropagation() {}, defaultPrevented: false, propagationStopped: false,
    ...overrides,
  } as KeyEvent
}
