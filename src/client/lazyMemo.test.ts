import { expect, test } from "bun:test"
import { createEffect, createRoot, createSignal } from "solid-js"
import { lazyMemo } from "./lazyMemo"

test("unread, a lazy memo never computes; read, once per change; readers hear of changes", () => {
  const [n, setN] = createSignal(1)
  let runs = 0
  const doubled = lazyMemo(() => { runs++; return n() * 2 })
  setN(2); setN(3)
  expect(runs).toBe(0)
  expect(doubled()).toBe(6)
  expect(doubled()).toBe(6)
  expect(runs).toBe(1)
  setN(4); setN(5)
  expect(runs).toBe(1)
  expect(doubled()).toBe(10)
  expect(runs).toBe(2)
  // A reader re-runs when an input changes, and the value it reads is fresh.
  const seen: number[] = []
  const dispose = createRoot((d) => { createEffect(() => seen.push(doubled())); return d })
  setN(6)
  expect(seen).toEqual([10, 12])
  expect(runs).toBe(3)
  dispose()
})
