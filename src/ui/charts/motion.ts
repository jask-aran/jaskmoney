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

/** The tour's draw-in. */
export const TOUR_CHART_MS = chartSpeedMs("juicy")

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
