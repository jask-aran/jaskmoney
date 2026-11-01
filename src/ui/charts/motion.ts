/**
 * When charts draw themselves in (ChartBody, reveal). Only on purpose:
 * once a launch, as the Overview first draws with data (index.tsx arms
 * it, the Overview takes it), and in the setup's tour on every view.
 * Nowhere else: not on a view switch, not on Budgets, never in tests
 * (which don't arm it).
 */
export const APP_CHART_MS = 350

const launch = { pending: false }

/** At start: the next takeLaunchReveal gets the draw-in. */
export function armLaunchReveal(): void {
  launch.pending = true
}

/** The launch's draw-in time, once: APP_CHART_MS the first time it's
 * asked after arming, 0 after that. */
export function takeLaunchReveal(): number {
  const ms = launch.pending ? APP_CHART_MS : 0
  launch.pending = false
  return ms
}
