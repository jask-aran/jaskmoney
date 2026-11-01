/** Only the latest run can write results; stopping also invalidates it. */
export function createLatestRun(): { start(): { signal: AbortSignal; isCurrent(): boolean }; stop(): void } {
  let active: AbortController | null = null

  function stop(): void {
    const previous = active
    active = null
    previous?.abort()
  }

  return {
    start() {
      stop()
      const current = new AbortController()
      active = current
      return { signal: current.signal, isCurrent: () => active === current }
    },
    stop,
  }
}
