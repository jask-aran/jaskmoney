/**
 * Two presses for what can't be taken back (state/armed in the TUI): the
 * first arms the button and says what a second press does; the same button
 * again does it. Pressing anywhere else, or esc, disarms.
 */
import { createSignal, onCleanup } from "solid-js"
import { say, status } from "../../store"

const [armed, setArmed] = createSignal<string | null>(null)

/** Whether the button `key` is armed. */
export const isArmed = (key: string) => armed() === key

/** Disarm, and take back the "Press again" line if it's still showing. */
export function disarm(): void {
  if (!armed()) return
  setArmed(null)
  if (status().text.startsWith("Press again to ")) say("")
}

/** Arm `key`, or on its second press do `act`. `what` finishes "Press again to …". */
export function confirmTwice(key: string, what: string, act: () => void): void {
  if (armed() === key) { setArmed(null); act(); return }
  setArmed(key)
  say(`Press again to ${what}`)
}

/** Disarm on a press outside the armed button (it carries `data-arm={key}`) or esc. */
export function useDisarm(): void {
  const down = (event: PointerEvent) => {
    const key = armed()
    if (!key) return
    const target = event.target as HTMLElement | null
    if (target?.closest(`[data-arm]`)?.getAttribute("data-arm") !== key) disarm()
  }
  const esc = (event: KeyboardEvent) => { if (event.key === "Escape") disarm() }
  window.addEventListener("pointerdown", down, true)
  window.addEventListener("keydown", esc)
  onCleanup(() => { window.removeEventListener("pointerdown", down, true); window.removeEventListener("keydown", esc) })
}
