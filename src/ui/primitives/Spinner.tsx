import { createEffect, createSignal, onCleanup } from "solid-js"
import { S } from "./S"

export const SPINNER = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
const SPIN_MS = 80

export function Spinner(props: { fg: string }) {
  const [frame, setFrame] = createSignal(0)
  const timer = setInterval(() => setFrame((f) => (f + 1) % SPINNER.length), SPIN_MS)
  onCleanup(() => clearInterval(timer))
  return <S fg={props.fg}>{SPINNER[frame()]!}</S>
}

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
