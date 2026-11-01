import type { CoreState } from "./protocol"

/** The CoreState flags that show a lane's run to the clients. */
export type LaneFlag = "upSyncing" | "suggesting" | "writingRules"

/**
 * Work of one kind that runs one at a time: an Up sync, a round of category
 * suggestions, the model writing rules. Its CoreState flag is true while a
 * run is going.
 *
 *   idle --run--> running --settles--> idle
 *   running --run--> (refused: `busy`)
 *   running --whenIdle(next)--> waits, then next() --> idle | running
 *
 * The flag clears only for the run that set it: `close()` resets the state
 * mid-run, and a newer run may have started since.
 */
export function createLane(core: { readonly state: CoreState; set: (patch: Partial<CoreState>) => void }, flag: LaneFlag, busy: string) {
  let running: Promise<unknown> | null = null

  /** Start `work` now, or refuse with `busy` while a run is going. */
  function run<T>(work: () => Promise<T>): Promise<T> {
    if (core.state[flag]) return Promise.reject(new Error(busy))
    core.set({ [flag]: true })
    const done: Promise<T> = work().finally(() => {
      if (running !== done) return
      running = null
      core.set({ [flag]: false })
    })
    running = done
    return done
  }

  /** Call `next` once no run is going. It's called in the same tick as the
   * last check, so a run it starts can't collide with another waiter's. */
  async function whenIdle<T>(next: () => T | Promise<T>): Promise<T> {
    while (core.state[flag] && running) await running.then(() => {}, () => {})
    return next()
  }

  return { run, whenIdle }
}

export type Lane = ReturnType<typeof createLane>
