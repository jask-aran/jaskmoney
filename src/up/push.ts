/** Category requests to the provider in flight at once. Up has no batch
 * endpoint, so each row is its own request; the client backs off when Up
 * says 429. (Tag pushes stay one at a time.) */
export const PUSH_CONCURRENCY = 4

/**
 * Push changes for `ids` (each once, started in order) to the provider,
 * `concurrency` at a time (default one). `prepare` makes a row's local-only
 * change itself and returns null, or returns the push (resolving to the
 * local rows it changed); a failed push is collected, not thrown.
 * `onSettled` runs after each push, `complete` after the last one.
 */
export async function pushTransactions(
  ids: number[],
  prepare: (id: number) => (() => Promise<number>) | null,
  options: { complete?: () => void; onSettled?: () => void; concurrency?: number } = {},
): Promise<{ changed: number; pushed: number; failures: string[] }> {
  const { complete, onSettled, concurrency = 1 } = options
  let changed = 0, pushed = 0
  const failures: string[] = []
  const pushes: Array<() => Promise<number>> = []
  for (const id of new Set(ids)) {
    const push = prepare(id)
    if (push) pushes.push(push)
  }
  let next = 0
  const worker = async () => {
    while (next < pushes.length) {
      const push = pushes[next++]!
      try {
        changed += await push()
        pushed++
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
      onSettled?.()
    }
  }
  // With nothing to push this runs before the first await, so a local-only
  // change shows at once.
  if (pushes.length) await Promise.all(Array.from({ length: Math.min(concurrency, pushes.length) }, worker))
  complete?.()
  return { changed, pushed, failures }
}
