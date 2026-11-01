import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { easeOut } from "./reveal"

/**
 * When charts draw themselves in (ChartBody, reveal), and how fast.
 *
 * By default ("launch"), once a launch: as the Overview first shows data,
 * or, when the setup opens over it, as the setup closes (index.tsx arms
 * it, the Overview takes it). "always": every chart, each time it shows
 * or its view changes. New data under the same view never redraws. The
 * setup's tour always draws in, at "juicy". Tests never arm the launch and
 * keep the default mode, so they see whole charts.
 */
export type ChartMotionMode = "launch" | "always"
export const CHART_MOTION_MODES: readonly ChartMotionMode[] = ["launch", "always"]
export const CHART_MOTION_LABELS: Record<ChartMotionMode, string> = { launch: "first launch", always: "always" }
export const DEFAULT_CHART_MOTION: ChartMotionMode = "launch"

/** Draw-in speeds, quickest first: from near instant to the tour's. */
export const CHART_SPEEDS = [
  { id: "instant", label: "near instant", ms: 120 },
  { id: "quick", label: "quick", ms: 350 },
  { id: "smooth", label: "smooth", ms: 600 },
  { id: "juicy", label: "juicy", ms: 900 },
] as const
export type ChartSpeedId = (typeof CHART_SPEEDS)[number]["id"]
export const DEFAULT_CHART_SPEED: ChartSpeedId = "quick"

/** A speed's draw-in time; an unknown or missing one is the default's. */
export function chartSpeedMs(id: string | undefined): number {
  return (CHART_SPEEDS.find((s) => s.id === id) ?? CHART_SPEEDS.find((s) => s.id === DEFAULT_CHART_SPEED)!).ms
}

/** The speed after `id`'s, wrapping from the slowest to the quickest. */
export function nextChartSpeed(id: string | undefined): (typeof CHART_SPEEDS)[number] {
  const at = CHART_SPEEDS.findIndex((s) => s.id === (id ?? DEFAULT_CHART_SPEED))
  return CHART_SPEEDS[(at + 1) % CHART_SPEEDS.length]!
}

/** When a chart's labels (a peak's name, a low, a total) appear as it
 * draws in: together, just before it's done, or each a beat after its
 * point, in order. */
export type ChartLabelMode = "together" | "sequential"
export const CHART_LABEL_MODES: readonly ChartLabelMode[] = ["together", "sequential"]
export const CHART_LABEL_LABELS: Record<ChartLabelMode, string> = { together: "together", sequential: "in order" }
export const DEFAULT_CHART_LABELS: ChartLabelMode = "together"

/** The tour's draw-in. */
export const TOUR_CHART_MS = chartSpeedMs("juicy")

/** How many times `seen` has turned true: in "always" mode a tab's chart
 * keys carry it, so a tab kept mounted while hidden draws its charts in
 * again each time it comes into view (back from another tab, or as the
 * setup closes over it). */
export function showings(seen: () => boolean): () => number {
  let was = false
  return createMemo((n: number) => {
    const now = seen()
    const next = now && !was ? n + 1 : n
    was = now
    return next
  }, 0)
}

/** How far through its draw-in a view is (0–1, eased): each new value of
 * `key` starts one over `ms` (a missing key or no time: drawn whole). The
 * key goes through a memo, which tells only when its value changes: a key
 * read again unchanged (a store array replaced around it, another pane's
 * view switching) starts nothing. The clock starts on the first tick, not
 * when asked: at launch the frames after the data lands are busy, and a
 * draw-in timed from the ask would be over before it's seen. */
export function useReveal(key: () => string | undefined, ms: () => number): () => number {
  const [shown, setShown] = createSignal(1)
  let timer: ReturnType<typeof setInterval> | undefined
  createEffect(on(createMemo(key), (k) => {
    clearInterval(timer)
    const total = ms()
    if (k === undefined || total <= 0) { setShown(1); return }
    setShown(0)
    let start: number | undefined
    // About a frame apart (OpenTUI draws at most 60 a second).
    timer = setInterval(() => {
      start ??= performance.now()
      const t = (performance.now() - start) / total
      setShown(easeOut(t))
      if (t >= 1) clearInterval(timer)
    }, 16)
  }))
  onCleanup(() => clearInterval(timer))
  return shown
}

const launch = { pending: false }

/** At start: the next takeLaunchReveal gets the draw-in. */
export function armLaunchReveal(): void {
  launch.pending = true
}

/** Whether this is the launch's draw-in: true the first time it's asked
 * after arming, false after that. */
export function takeLaunchReveal(): boolean {
  const first = launch.pending
  launch.pending = false
  return first
}
