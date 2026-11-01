import { createComputed, createRoot, createSignal } from "solid-js"

/**
 * A derived value computed only when read: createMemo runs at once and
 * again on every change of what it reads, whether or not anything reads
 * it, and the store's whole-history derivations (rule offers, note
 * prompts, trips) cost ~5-15 ms each on every write and at start.
 *
 * Read, it computes (tracking what `fn` reads) and keeps the value; a
 * change of any of those marks it stale and tells its readers, which read
 * it again and so recompute it once. Unread, a change costs nothing more
 * than marking it stale. The value is fresh after any write returns (Solid
 * runs the tracking before setState returns); inside an explicit batch() a
 * read can see the value from before the batch's writes.
 */
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
          // An input changed: drop the tracking until the next read.
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
