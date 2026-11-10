import { createComputed, createRoot, createSignal } from "solid-js"

export function lazyMemo<T>(fn: () => T): () => T {
  const [changed, signal] = createSignal(undefined, { equals: false })
  let stale = true
  let value: T
  let dispose: (() => void) | undefined
  return () => {
    changed()
    if (stale) {
      dispose?.()
      createRoot((done) => {
        dispose = done
        let first = true
        createComputed(() => {
          if (first) { first = false; value = fn(); return }
          stale = true
          dispose?.()
          dispose = undefined
          signal()
        })
      })
      stale = false
    }
    return value
  }
}
