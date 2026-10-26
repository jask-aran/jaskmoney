/**
 * Push changes for `ids` (each once, in order) to the provider one at a
 * time. `prepare` makes a row's local-only change itself and returns null,
 * or returns the push (resolving to the local rows it changed); a failed
 * push is collected, not thrown. `complete` runs after the last one.
 */
export async function pushTransactions(
  ids: number[],
  prepare: (id: number) => (() => Promise<number>) | null,
  complete?: () => void,
): Promise<{ changed: number; pushed: number; failures: string[] }> {
  let changed = 0, pushed = 0
  const failures: string[] = []
  for (const id of new Set(ids)) {
    const push = prepare(id)
    if (!push) continue
    try {
      changed += await push()
      pushed++
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error))
    }
  }
  // With nothing to push this runs before the first await, so a local-only
  // change shows at once.
  complete?.()
  return { changed, pushed, failures }
}
