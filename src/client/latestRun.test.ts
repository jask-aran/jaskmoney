import { expect, test } from "bun:test"
import { createLatestRun } from "./latestRun"

test("starting a run aborts and invalidates its predecessor", () => {
  const runs = createLatestRun()
  const first = runs.start()
  expect(first.isCurrent()).toBe(true)
  const second = runs.start()
  expect(first.signal.aborted).toBe(true)
  expect(first.isCurrent()).toBe(false)
  expect(second.signal.aborted).toBe(false)
  expect(second.isCurrent()).toBe(true)
})

test("stop invalidates before abort listeners run and permits another start", () => {
  const runs = createLatestRun()
  const first = runs.start()
  let currentAtAbort: boolean | undefined
  first.signal.addEventListener("abort", () => { currentAtAbort = first.isCurrent() })
  runs.stop()
  runs.stop()
  expect(currentAtAbort).toBe(false)
  expect(first.signal.aborted).toBe(true)
  expect(first.isCurrent()).toBe(false)
  expect(runs.start().isCurrent()).toBe(true)
})
