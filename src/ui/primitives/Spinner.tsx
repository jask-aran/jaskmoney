import { createEffect, createSignal, onCleanup } from "solid-js"
import { S } from "./S"

/** Braille spinner frames, one a tick. */
export const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
const SPIN_MS = 80

/** A spinner, as a span in a line of text: it ticks while it's drawn, and
 * stops (its timer cleared) when it's gone. */
export function Spinner(props: { fg: string }) {
  const [frame, setFrame] = createSignal(0)
  const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), SPIN_MS)
  onCleanup(() => clearInterval(timer))
  return <S fg={props.fg}>{SPINNER[frame()]!}</S>
}

/** A spinner's frame for a row built from spans: it ticks while `on()`
 * holds (its timer cleared otherwise and on cleanup); "" while off. */
export function spinnerFrame(on: () => boolean): () => string {
  const [frame, setFrame] = createSignal(0)
  let timer: ReturnType<typeof setInterval> | undefined
  createEffect(() => {
    if (on() && !timer) timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), SPIN_MS)
    if (!on() && timer) { clearInterval(timer); timer = undefined }
  })
  onCleanup(() => clearInterval(timer))
  return () => (on() ? SPINNER[frame()]! : "")
}
