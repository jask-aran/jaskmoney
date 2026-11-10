import type { CoreState } from "./protocol"

type LaneFlag = "upSyncing" | "suggesting" | "writingRules"

export function createLane(core: { readonly state: CoreState; set: (patch: Partial<CoreState>) => void }, flag: LaneFlag, busy: string) {
  let running: Promise<unknown> | null = null

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

  async function whenIdle<T>(next: () => T | Promise<T>): Promise<T> {
    while (core.state[flag] && running) await running.then(() => {}, () => {})
    return next()
  }

  return { run, whenIdle }
}

export type Lane = ReturnType<typeof createLane>
