import { createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { easeOut } from "./reveal"

export type ChartMotionMode = "launch" | "always" | "off"
export const CHART_MOTION_MODES: readonly ChartMotionMode[] = ["launch", "always", "off"]
export const CHART_MOTION_LABELS: Record<ChartMotionMode, string> = { launch: "first launch", always: "always", off: "off" }
export const DEFAULT_CHART_MOTION: ChartMotionMode = "launch"

export function nextChartMotion(mode: ChartMotionMode | undefined): ChartMotionMode {
  return CHART_MOTION_MODES[(CHART_MOTION_MODES.indexOf(mode ?? DEFAULT_CHART_MOTION) + 1) % CHART_MOTION_MODES.length]!
}

export const CHART_SPEEDS = [
  { id: "instant", label: "near instant", ms: 120 },
  { id: "quick", label: "quick", ms: 350 },
  { id: "smooth", label: "smooth", ms: 600 },
  { id: "juicy", label: "juicy", ms: 900 },
] as const
export type ChartSpeedId = (typeof CHART_SPEEDS)[number]["id"]
export const DEFAULT_CHART_SPEED: ChartSpeedId = "quick"

export function chartSpeedMs(id: string | undefined): number {
  return (CHART_SPEEDS.find((s) => s.id === id) ?? CHART_SPEEDS.find((s) => s.id === DEFAULT_CHART_SPEED)!).ms
}

export const CHART_CURVES = [
  { id: "quadratic", label: "quadratic", feel: "gentle", power: 2 },
  { id: "cubic", label: "cubic", feel: "smooth", power: 3 },
  { id: "quartic", label: "quartic", feel: "sharp", power: 4 },
] as const
export type ChartCurveId = (typeof CHART_CURVES)[number]["id"]
export const DEFAULT_CHART_CURVE: ChartCurveId = "cubic"

function chartCurvePower(id: string | undefined): number {
  return (CHART_CURVES.find((c) => c.id === id) ?? CHART_CURVES.find((c) => c.id === DEFAULT_CHART_CURVE)!).power
}

export function chartCurveName(curve: (typeof CHART_CURVES)[number]): string {
  return `${curve.label} (${curve.feel})`
}

export function nextChartCurve(id: string | undefined): (typeof CHART_CURVES)[number] {
  const at = CHART_CURVES.findIndex((c) => c.id === (id ?? DEFAULT_CHART_CURVE))
  return CHART_CURVES[(at + 1) % CHART_CURVES.length]!
}

export function nextChartSpeed(id: string | undefined): (typeof CHART_SPEEDS)[number] {
  const at = CHART_SPEEDS.findIndex((s) => s.id === (id ?? DEFAULT_CHART_SPEED))
  return CHART_SPEEDS[(at + 1) % CHART_SPEEDS.length]!
}

export type ChartLabelMode = "together" | "sequential"
export const CHART_LABEL_MODES: readonly ChartLabelMode[] = ["together", "sequential"]
export const CHART_LABEL_LABELS: Record<ChartLabelMode, string> = { together: "together", sequential: "in order" }
export const DEFAULT_CHART_LABELS: ChartLabelMode = "together"

export const TOUR_CHART_MS = chartSpeedMs("juicy")

export function showings(seen: () => boolean): () => number {
  let was = false
  return createMemo((n: number) => {
    const now = seen()
    const next = now && !was ? n + 1 : n
    was = now
    return next
  }, 0)
}

export function useReveal(key: () => string | undefined, ms: () => number, curve: () => string | undefined = () => undefined): () => number {
  const [shown, setShown] = createSignal(1)
  let timer: ReturnType<typeof setInterval> | undefined
  createEffect(on(createMemo(key), (k) => {
    clearInterval(timer)
    const total = ms()
    if (k === undefined || total <= 0) { setShown(1); return }
    const power = chartCurvePower(curve())
    setShown(0)
    let start: number | undefined
    timer = setInterval(() => {
      start ??= performance.now()
      const t = (performance.now() - start) / total
      setShown(easeOut(t, power))
      if (t >= 1) clearInterval(timer)
    }, 16)
  }))
  onCleanup(() => clearInterval(timer))
  return shown
}

const launch = { pending: false }

export function armLaunchReveal(): void {
  launch.pending = true
}

export function takeLaunchReveal(): boolean {
  const first = launch.pending
  launch.pending = false
  return first
}
