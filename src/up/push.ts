export const PUSH_CONCURRENCY = 4

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
        const n = await push()
        changed += n
        pushed++
      } catch (error) {
        failures.push(error instanceof Error ? error.message : String(error))
      }
      onSettled?.()
    }
  }
  if (pushes.length) await Promise.all(Array.from({ length: Math.min(concurrency, pushes.length) }, worker))
  complete?.()
  return { changed, pushed, failures }
}
