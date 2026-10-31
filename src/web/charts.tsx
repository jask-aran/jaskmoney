/**
 * The web app's charts: one SVG renderer for every chart model the tabs
 * build (tabs/overview/periodCharts), as the TUI's ChartBody is for its
 * cell models. A model says what to draw in data terms (x units, money);
 * the renderer fits it to the box it's given: the axis as wide as its
 * labels, gridlines, rules, bars and lines, then the labels, each placed
 * where it touches no line, bar or other label (shorter forms, then
 * further along its line, before it's dropped), the date labels by
 * priority with room between them, and a crosshair with a tooltip.
 *
 * Text takes the ink roles; colour is for the marks (series, bars, rules),
 * and a label away from its mark carries a swatch of it.
 */
import { For, Index, Show, createMemo, createSignal, onCleanup, onMount } from "solid-js"
import { CurveType, PlotlineLineStylePresets, Position } from "@unovis/ts"
import { VisAnnotations, VisArea, VisAxis, VisAxisSelectors, VisCrosshair, VisGroupedBar, VisGroupedBarSelectors, VisLine, VisPlotline, VisScatter, VisStackedBar, VisStackedBarSelectors, VisTooltip, VisXYContainer } from "@unovis/solid"
import "./tabs/overview/charts.css"
import { shortMoney } from "../ui/text"
import { INKS } from "../ui/charts/inks"
import { ink, theme, tone } from "./theme"
import { compact } from "./store"

/** The series and rules' colours, by what each is: the TUI's own (its
 * chart renderer's INKS), so a chart reads the same in both. */
export { INKS }

/** Gridlines: weeks quiet, months and years in their colours (the TUI's), all recessive. */
const MARKER = {
  week: { color: INKS.week!, opacity: 0.9 },
  month: { color: INKS.month!, opacity: 0.35 },
  year: { color: INKS.year!, opacity: 0.5 },
  today: { color: INKS.today!, opacity: 0.9 },
} as const

export type LineStyle = "solid" | "dotted" | "dashed"

export interface LineSeries {
  /** One per x position; null leaves a gap (days after today). */
  values: Array<number | null>
  color: string
  name: string
  style?: LineStyle
  /** Stroke width (2 by default). */
  width?: number
  /** A wash under the line. */
  area?: boolean
  /** A dot at its last point. */
  endDot?: boolean
  /** Left out of the tooltip (it says the same as another). */
  quiet?: boolean
}

export interface BarMark {
  /** The x slot. */
  slot: number
  value: number
  color: string
  /** Side by side in a slot: this one's place of `subs`. */
  sub?: number
  subs?: number
}

/** A horizontal reference line (an average, a budget's share), over x units `from`–`to`. */
export interface RuleMark {
  value: number
  color: string
  from?: number
  to?: number
  style?: LineStyle
}

/** A vertical gridline at x units `at`. */
export interface Marker {
  at: number
  kind: "week" | "month" | "year" | "today"
}

export interface TextPart { text: string; cls?: string }

/** A date (or period) under the plot; placed by priority (lower first). */
export interface XLabel {
  at: number
  text: string
  priority: number
  align?: "start" | "center" | "end"
  cls?: string
  /** A coloured second line under it (a cash flow period's net). */
  below?: TextPart
}

/** A point drawn on a line: one of the biggest days, or ▲ past the top. */
export interface PointMark {
  at: number
  value: number
  color: string
}

/**
 * A label in the plot, beside the point (or bar) it describes. `texts`
 * longest first; where none fits at the point, `name` tries each point
 * `along` its line, nearest first. A `required` label goes in its first
 * place even where nothing is free.
 */
export interface PointLabel {
  at: number
  value: number
  texts: string[]
  /** Text role: figure (the latest value), label, note (highs and lows). */
  role?: "figure" | "label" | "note" | "bad" | "good"
  /** The mark's colour, as a swatch before the text. */
  swatch?: string
  swatchStyle?: LineStyle
  required?: boolean
  bar?: { slot: number; sub?: number; subs?: number }
  along?: Array<{ at: number; value: number }>
  name?: string
}

export interface LegendItem {
  mark?: { kind: "line" | "bar" | "swatches"; color: string; style?: LineStyle; colors?: readonly string[] }
  parts: TextPart[]
  title?: string
}

export interface TipRow { color?: string; style?: LineStyle | "bar"; label: string; value: string; cls?: string; /** A detail of the row above (its biggest payee). */ sub?: boolean }
export interface Tip { title: string; rows: TipRow[]; note?: string }

export interface ChartModel {
  /** Points: x units 0..length-1 span the plot; slots: each unit a band. */
  x: "points" | "slots"
  length: number
  y: { min: number; max: number; ticks: number[] }
  series?: LineSeries[]
  bars?: BarMark[]
  rules?: RuleMark[]
  markers?: Marker[]
  points?: PointMark[]
  xLabels?: XLabel[]
  labels?: PointLabel[]
  legend: LegendItem[]
  /** What hovering x unit `index` says. */
  tip?: (index: number) => Tip | null
  /** Nothing to draw: why (the legend says it too). */
  empty?: string
}

/* ------------------------------------------------------------------ */
/* Measuring and scales                                                */
/* ------------------------------------------------------------------ */

/** The charts' text: the data face at the label size, its weights (the type
 * tokens --font-data, --text-label, --weight-data, --weight-strong),
 * resolved once from a probe so Unovis's text and the measuring agree. */
let type: { family: string; size: number; weight: number; strong: number } | null = null
function chartType() {
  if (!type) {
    const el = document.createElement("span")
    el.style.cssText = "position:absolute;visibility:hidden;font-family:var(--font-data);font-size:var(--text-label);font-weight:var(--weight-data)"
    document.body.appendChild(el)
    const cs = getComputedStyle(el)
    const strong = Number(getComputedStyle(document.documentElement).getPropertyValue("--weight-strong").trim()) || 600
    type = { family: cs.fontFamily, size: parseFloat(cs.fontSize) || 11, weight: Number(cs.fontWeight) || 400, strong }
    el.remove()
  }
  return type
}
const fontFamily = () => chartType().family
/** Bumped when a web font finishes loading: widths measured before it are wrong. */
const [fontEpoch, setFontEpoch] = createSignal(0)
document.fonts?.addEventListener("loadingdone", () => { measured.clear(); setFontEpoch((n) => n + 1) })
let measureCtx: CanvasRenderingContext2D | null | undefined
const measured = new Map<string, number>()

/** A chart text's width in px, in the charts' font (canvas-measured, emoji included). */
export function textWidth(text: string): number {
  let w = measured.get(text)
  if (w === undefined) {
    if (measureCtx === undefined) measureCtx = document.createElement("canvas").getContext("2d")
    if (measureCtx) { measureCtx.font = `${chartType().weight} ${chartType().size}px ${fontFamily()}`; w = measureCtx.measureText(text).width } else w = [...text].length * 6.6
    if (measured.size > 4000) measured.clear()
    measured.set(text, w)
  }
  return w
}

/** A chart's cells: the TUI's decisions (in terminal columns) taken at this many px a column. */
export const CELL = 7

/** A round axis ceiling for `max` and its tick step (1, 2, 2.5 or 5 × 10^k), as the TUI's. */
export function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 1 }
  const raw = max / ticks
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!
  return { max: Math.ceil(max / step - 1e-9) * step, step }
}

function niceRange(lo: number, hi: number, ticks = 4): { min: number; max: number; step: number } {
  const spread = hi - lo || Math.abs(hi) || 1
  const { step } = niceScale(spread, ticks)
  const min = Math.floor(lo / step + 1e-9) * step
  let max = Math.ceil(hi / step - 1e-9) * step
  if (max <= min) max = min + step
  return { min, max, step }
}

/** Axis bounds for a level series (balances): its own low and high with a
 * little headroom either side, or from $0 with `zero`; as the TUI's fitRange
 * over a plot of about `rows` text lines. */
export function fitRange(lo: number, hi: number, rows: number, zero = false): { min: number; max: number; step: number } {
  if (zero) [lo, hi] = [Math.min(0, lo), Math.max(0, hi)]
  if (hi === lo) return niceRange(lo, hi)
  const pad = rows > 2 ? (hi - lo) / (rows - 2) : 0
  const min = zero && lo === 0 ? 0 : lo - pad
  const max = zero && hi === 0 ? 0 : hi + pad
  return { min, max, step: niceScale(max - min).step }
}

/** Every multiple of `step` from `min` to `max`. */
export function ticksOf(min: number, max: number, step: number): number[] {
  const out: number[] = []
  for (let k = Math.ceil(min / step - 1e-9); k * step <= max + step * 1e-9; k++) out.push(k * step)
  return out
}

/* ------------------------------------------------------------------ */
/* Placing labels                                                      */
/* ------------------------------------------------------------------ */

interface Box { x: number; y: number; w: number; h: number }
const LABEL_H = 13

const hits = (a: Box, b: Box, mx: number, my: number) =>
  a.x < b.x + b.w + mx && b.x < a.x + a.w + mx && a.y < b.y + b.h + my && b.y < a.y + a.h + my

/** Whether any line runs through `r` (a little padding round it). */
function crossesLine(lines: Array<Array<[number, number]>>, r: Box, pad = 2): boolean {
  const x0 = r.x - pad, x1 = r.x + r.w + pad, y0 = r.y - pad, y1 = r.y + r.h + pad
  for (const pts of lines) {
    if (pts.length === 1) {
      const [px, py] = pts[0]!
      if (px >= x0 && px <= x1 && py >= y0 && py <= y1) return true
      continue
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i]!, [bx, by] = pts[i + 1]!
      if (bx < x0 || ax > x1) continue
      const dx = bx - ax
      const t0 = dx === 0 ? 0 : Math.max(0, (x0 - ax) / dx), t1 = dx === 0 ? 1 : Math.min(1, (x1 - ax) / dx)
      const ya = ay + (by - ay) * t0, yb = ay + (by - ay) * t1
      if (Math.max(ya, yb) >= y0 && Math.min(ya, yb) <= y1) return true
    }
  }
  return false
}

export interface Placed { x: number; y: number; w: number; text: string; role: string; swatch?: string; swatchStyle?: LineStyle; /** The point it describes, when it sits away from it. */ anchor?: [number, number] }

/**
 * The labels, in order (the first win the room): each at its first spot
 * clear of the lines, bars and labels placed before it; a bar's label over
 * its bar, beside its top, or higher up, never over a neighbour.
 */
function placeLabels(
  labels: PointLabel[],
  pos: (at: number, value: number) => [number, number],
  barBox: (bar: NonNullable<PointLabel["bar"]>, value: number) => Box,
  bounds: Box,
  lines: Array<Array<[number, number]>>,
  bars: Box[],
): Placed[] {
  const placed: Placed[] = []
  const taken: Box[] = []
  const inside = (r: Box) => r.x >= bounds.x && r.x + r.w <= bounds.x + bounds.w && r.y >= bounds.y && r.y + r.h <= bounds.y + bounds.h
  const near = (a: Box, b: Box) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.w - b.w) < 0.5
  const clear = (r: Box, own?: Box) =>
    inside(r) && !taken.some((t) => hits(r, t, 6, 1)) && !bars.some((b) => !(own && near(b, own)) && hits(r, b, 2, 1)) && !crossesLine(lines, r)
  const clampX = (x: number, w: number) => Math.max(bounds.x, Math.min(bounds.x + bounds.w - w, x))
  const width = (text: string) => Math.ceil(textWidth(text))
  type Spot = { box: Box; text: string; point?: [number, number] }
  const keep = (label: PointLabel, pick: Spot) => {
    taken.push(pick.box)
    // A label more than a few px from its point keeps a leader to it.
    const p = pick.point
    const away = p && (Math.max(pick.box.x - p[0], p[0] - (pick.box.x + pick.box.w), 0) ** 2 + Math.max(pick.box.y - p[1], p[1] - (pick.box.y + pick.box.h), 0) ** 2) > 100
    placed.push({ ...pick.box, text: pick.text, role: label.role ?? "label", swatch: label.swatch, swatchStyle: label.swatchStyle, anchor: away ? p : undefined })
  }
  for (const label of labels) {
    const spots: Spot[] = []
    if (label.bar) {
      const own = barBox(label.bar, label.value)
      const cx = own.x + own.w / 2
      for (const text of label.texts) {
        const w = width(text)
        spots.push({ box: { x: clampX(cx - w / 2, w), y: own.y - 3 - LABEL_H, w, h: LABEL_H }, text })
      }
      for (const text of label.texts) {
        const w = width(text)
        spots.push({ box: { x: own.x + own.w + 4, y: own.y, w, h: LABEL_H }, text })
        spots.push({ box: { x: own.x - 4 - w, y: own.y, w, h: LABEL_H }, text })
      }
      for (let up = 1; up <= 3; up++) {
        const text = label.texts[label.texts.length - 1]!, w = width(text)
        spots.push({ box: { x: clampX(cx - w / 2, w), y: own.y - 3 - LABEL_H - up * (LABEL_H + 2), w, h: LABEL_H }, text })
      }
      const pick = spots.find((s) => clear(s.box, own)) ?? (label.required ? spots.find((s) => inside(s.box)) : undefined)
      if (pick) keep(label, pick)
      continue
    }
    const around = (px: number, py: number, text: string, far: boolean): Spot[] => {
      const w = width(text), h = LABEL_H, mid = py - h / 2
      const out: Box[] = [
        { x: px + 7, y: mid, w, h },
        { x: px - 7 - w, y: mid, w, h },
        { x: clampX(px - w / 2, w), y: py - 7 - h, w, h },
        { x: clampX(px - w / 2, w), y: py + 7, w, h },
        { x: px + 4, y: py - 6 - h, w, h },
        { x: px - 4 - w, y: py - 6 - h, w, h },
        { x: px + 4, y: py + 6, w, h },
        { x: px - 4 - w, y: py + 6, w, h },
      ]
      if (far) out.push({ x: clampX(px - w / 2, w), y: py - 12 - 2 * h, w, h }, { x: clampX(px - w / 2, w), y: py + 12 + h, w, h }, { x: px - w - 10, y: py - 12 - 2 * h, w, h }, { x: px - w - 10, y: py + 12 + h, w, h })
      return out.map((box) => ({ box, text, point: [px, py] }))
    }
    const [px, py] = pos(label.at, label.value)
    for (const text of label.texts) spots.push(...around(px, py, text, true))
    if (label.name && label.along) for (const p of label.along) { const [ax, ay] = pos(p.at, p.value); spots.push(...around(ax, ay, label.name, false)) }
    const pick = spots.find((s) => clear(s.box)) ?? (label.required ? spots.find((s) => inside(s.box)) ?? spots[0] : undefined)
    if (pick) keep(label, pick)
  }
  return placed
}

/** Date labels by priority, each kept 10px clear of those placed; a centred
 * one that would run off an end is set flush with it instead. */
function placeXLabels(labels: XLabel[], xAt: (at: number) => number, left: number, right: number): Array<XLabel & { x: number; align: "start" | "center" | "end" }> {
  const taken: Array<[number, number]> = []
  const out: Array<XLabel & { x: number; align: "start" | "center" | "end" }> = []
  for (const label of [...labels].sort((a, b) => a.priority - b.priority)) {
    const w = Math.max(textWidth(label.text), label.below ? textWidth(label.below.text) : 0)
    const at = xAt(label.at)
    let align = label.align ?? "center"
    if (align === "center" && at - w / 2 < left) align = "start"
    if (align === "center" && at + w / 2 > right) align = "end"
    const start = align === "start" ? at : align === "end" ? at - w : at - w / 2
    if (start < left - 1 || start + w > right + 1) continue
    if (taken.some(([a, b]) => start < b + 10 && a < start + w + 10)) continue
    taken.push([start, start + w])
    out.push({ ...label, x: start, align })
  }
  return out
}

/* ------------------------------------------------------------------ */
/* The chart: Unovis                                                   */
/* ------------------------------------------------------------------ */

const DASH: Record<LineStyle, string | undefined> = { solid: undefined, dotted: "2 4", dashed: "6 4" }
const DASH_ARRAY: Record<LineStyle, number[] | undefined> = { solid: undefined, dotted: [2, 4], dashed: [6, 4] }

/** One x position's datum: what the bars, the crosshair and the tooltip read. */
interface Row { x: number; bar?: number; color?: string; in?: number; out?: number }
interface Pt { x: number; y: number | null }

const esc = (text: string) => text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!)
/** A tooltip's HTML (the crosshair's template): the date, then each series' mark, name and figure. */
function tipHtml(tip: Tip): string {
  const mark = (row: TipRow) => !row.color ? "" : row.style === "bar"
    ? `<span class="swatch bar" style="background:${row.color}"></span>`
    : `<svg class="swatch line" width="16" height="8"><line x1="2" x2="14" y1="4" y2="4" stroke="${row.color}" stroke-width="2" stroke-linecap="round"${DASH[(row.style as LineStyle) ?? "solid"] ? ` stroke-dasharray="${DASH[row.style as LineStyle]}"` : ""}/></svg>`
  return `<div class="chart-tip"><div class="title">${esc(tip.title)}</div>${tip.rows.map((row) =>
    `<div class="row${row.sub ? " sub" : ""}">${mark(row)}<span class="k">${esc(row.label)}</span><span class="v ${row.cls ?? ""}">${esc(row.value)}</span></div>`).join("")}${tip.note ? `<div class="note">${esc(tip.note)}</div>` : ""}</div>`
}

/** The text colour of a label's role. */
const ROLE: Record<string, string> = { figure: ink.strong, label: ink.label, note: ink.note, good: tone.good, bad: tone.bad, today: theme.chartToday }

const MARGIN = { top: 18, right: 6, bottom: 22 }

/**
 * A chart in the box it's given (it fills its parent), drawn by Unovis:
 * `build` makes the model for a plot about `width` × `height` px. Lines,
 * areas, bars, gridlines (Plotline), axes, a crosshair with its tooltip,
 * and the model's labels as annotations, each where placeLabels found it
 * room. Clicking a bar picks its x unit (`onPick`).
 */
export function Chart(props: { build: (width: number, height: number) => ChartModel; onPick?: (index: number) => void; class?: string }) {
  let box!: HTMLDivElement
  const [size, setSize] = createSignal({ w: 0, h: 0 })
  onMount(() => {
    const observer = new ResizeObserver((entries) => {
      const r = entries[0]!.contentRect
      // Hidden (another tab), the box measures 0: keep what it had.
      if (r.width < 10 || r.height < 10) return
      setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: Math.round(r.width), h: Math.round(r.height) }))
    })
    observer.observe(box)
    onCleanup(() => observer.disconnect())
  })
  const model = createMemo(() => (size().w ? props.build(Math.max(40, size().w - 60), Math.max(40, size().h - MARGIN.top - MARGIN.bottom)) : null))
  const fmt = (v: number) => shortMoney(Math.abs(v) < 1e-9 ? 0 : v)

  // The plot's geometry: explicit margins (the y axis as wide as its
  // labels) and no bleed, so a value's px is known and labels can be placed.
  const geo = createMemo(() => {
    fontEpoch()
    const m = model()
    const { w, h } = size()
    if (!m || m.empty || !w) return null
    const left = Math.ceil(Math.max(0, ...m.y.ticks.map((v) => textWidth(fmt(v))))) + 10
    const margin = { left, top: MARGIN.top, right: MARGIN.right, bottom: MARGIN.bottom + ((m.xLabels ?? []).some((l) => l.below) ? 18 : 0) }
    const pw = Math.max(1, w - left - margin.right), ph = Math.max(1, h - margin.top - margin.bottom)
    const n = Math.max(1, m.length)
    const xDomain: [number, number] = m.x === "points" ? (n <= 1 ? [-0.5, 0.5] : [0, n - 1]) : [-0.5, n - 0.5]
    const xAt = (at: number) => ((at - xDomain[0]) / (xDomain[1] - xDomain[0])) * pw
    const span = m.y.max - m.y.min || 1
    const yAt = (v: number) => ph - ((Math.max(m.y.min, Math.min(m.y.max, v)) - m.y.min) / span) * ph
    const slotW = pw / n
    const grouped = (m.bars ?? []).some((b) => (b.subs ?? 1) > 1)
    const groupW = Math.max(1, Math.min(slotW * (grouped ? 0.7 : 0.66), grouped ? 76 : 52))
    const gap = grouped ? Math.min(2, groupW * 0.08) : 0
    const barW = grouped ? (groupW - gap) / 2 : groupW
    const barBox = (bar: { slot: number; sub?: number; subs?: number }, value: number): Box => {
      const x = xAt(bar.slot) - groupW / 2 + (grouped ? (bar.sub ?? 0) * (barW + gap) : 0)
      const y = yAt(Math.max(0, value))
      return { x, y, w: barW, h: Math.max(0, yAt(0) - y) }
    }
    // Rules are lines from one x to another (slot edges on bar charts).
    const ruleSeries = (m.rules ?? []).map((r) => {
      const from = r.from == null ? xDomain[0] : m.x === "slots" ? r.from - 0.5 : r.from
      const to = r.to == null ? xDomain[1] : m.x === "slots" ? r.to - 0.5 : r.to
      return { data: [{ x: from, y: r.value }, { x: to, y: r.value }] as Pt[], color: r.color, style: r.style ?? "dashed", width: 1.5 }
    }).filter((r) => r.data[1]!.x > r.data[0]!.x)
    const series = (m.series ?? []).map((s) => ({ data: s.values.map((y, x) => ({ x, y })) as Pt[], color: s.color, style: s.style ?? "solid", width: s.width ?? 2, area: !!s.area, name: s.name }))
    const lines = [...series, ...ruleSeries].map((s) => s.data.filter((p) => p.y != null).map((p): [number, number] => [xAt(p.x), yAt(p.y!)]))
    const bars = (m.bars ?? []).filter((b) => b.value > 0).map((b) => barBox(b, b.value))
    const placed = placeLabels(m.labels ?? [], (at, v) => [xAt(at), yAt(v)], barBox, { x: 0, y: -margin.top + 2, w: pw, h: ph + margin.top - 2 }, lines, bars)
    const xLabels = placeXLabels(m.xLabels ?? [], xAt, 0, pw)
    // Labels as annotations: text in its role's ink; one away from its
    // point keeps a leader to it in the mark's colour.
    const items = [
      ...placed.map((l) => ({
        x: l.x, y: l.y, content: { text: l.text, fontSize: chartType().size, fontFamily: fontFamily(), color: ROLE[l.role] ?? ink.label, fontWeight: l.role === "figure" ? chartType().strong : chartType().weight },
        ...(l.swatch && l.anchor ? { subject: { x: l.anchor[0], y: l.anchor[1], radius: 0, padding: 3, connectorLineColor: l.swatch, strokeColor: l.swatch, connectorLineStrokeDasharray: DASH[l.swatchStyle ?? "solid"] } } : {}),
      })),
      // A period's net on a second line under its date.
      ...xLabels.filter((l) => l.below).map((l) => {
        const w = textWidth(l.below!.text), at = xAt(l.at)
        const x = l.align === "start" ? at : l.align === "end" ? at - w : at - w / 2
        return { x, y: ph + 25, content: { text: l.below!.text, fontSize: chartType().size, fontFamily: fontFamily(), fontWeight: chartType().weight, color: ROLE[l.below!.cls ?? ""] ?? ink.note } }
      }),
    ]
    const axisTicks = xLabels
    const rows: Row[] = Array.from({ length: n }, (_, x) => ({ x }))
    for (const b of m.bars ?? []) {
      const row = rows[b.slot]
      if (!row) continue
      if (grouped) row[(b.sub ?? 0) === 0 ? "in" : "out"] = b.value
      else { row.bar = b.value; row.color = b.color }
    }
    return {
      w, h, margin, pw, ph, n, xDomain, yDomain: [m.y.min, m.y.max] as [number, number], xAt, yAt, slotW,
      series, ruleSeries, rows, grouped, groupW, barW, items, axisTicks,
      // Bars carry no crosshair circles; lines a dot on each series there.
      circleSeries: (m.series ?? []).filter((s) => !s.quiet),
      points: [
        ...(m.points ?? []).map((p) => ({ x: p.at, y: Math.min(p.value, m.y.max), color: p.color, over: p.value > m.y.max })),
        // Each line's latest value, as a dot at its end.
        ...(m.series ?? []).filter((s) => s.endDot).flatMap((s) => {
          const at = s.values.findLastIndex((v) => v != null)
          return at < 0 ? [] : [{ x: at, y: s.values[at]!, color: s.color, over: false }]
        }),
      ],
      key: `${m.x}|${n}|${(m.series ?? []).length}|${ruleSeries.length}|${grouped}|${(m.bars ?? []).length > 0}|${(m.points ?? []).length > 0}`,
    }
  })
  const barColors = [INKS.in, INKS.out]
  const tickText = (v: number) => geo()?.axisTicks.find((t) => Math.abs(t.at - v) < 1e-6)?.text ?? ""
  const tickTone = (v: number) => geo()?.axisTicks.find((t) => Math.abs(t.at - v) < 1e-6)?.cls ?? ""
  const tickAlign = (v: number) => {
    const align = geo()?.axisTicks.find((t) => Math.abs(t.at - v) < 1e-6)?.align ?? "center"
    return align === "start" ? "left" : align === "end" ? "right" : "center"
  }

  // A finger: Unovis's crosshair follows the mouse alone, and a touch sends it one mousemove where it lands. A drag
  // along the chart (vertical drags still scroll the page: touch-action) moves it as the mouse would.
  const touch = (event: PointerEvent) => {
    if (event.pointerType !== "touch") return
    box.querySelector(".chart-vis svg")?.dispatchEvent(new MouseEvent("mousemove", { clientX: event.clientX, clientY: event.clientY, bubbles: true }))
  }

  return (
    <div class={`chart-wrap ${props.class ?? ""}`}>
      <div class="chart" ref={box} onPointerDown={touch} onPointerMove={touch}>
        <Show when={model()?.empty}><div class="chart-empty">{model()!.empty}</div></Show>
        {/* A new kind of chart (other series, bars or lines) mounts afresh; a new range or size updates it. */}
        <Show when={geo()?.key} keyed>{(_key) => {
          const g = () => geo()!
          return (
            <VisXYContainer<Row> height={g().h} margin={g().margin} autoMargin={false} bleed={{ top: 0, bottom: 0, left: 0, right: 0 }}
              xDomain={g().xDomain} yDomain={g().yDomain} class="chart-vis">
              <VisAxis<Row> type="y" tickValues={model()!.y.ticks} tickFormat={(v: number | Date) => fmt(Number(v))} gridLine domainLine={false} tickLine={false} tickPadding={8} numTicks={model()!.y.ticks.length} />
              <VisAxis<Row> type="x" tickValues={g().axisTicks.map((t) => t.at)} tickFormat={(v: number | Date) => tickText(Number(v))} tickTextAlign={(v: number | Date) => tickAlign(Number(v))}
                gridLine={false} domainLine={false} tickLine={false} tickPadding={6} tickTextWidth={160} tickTextHideOverlapping={false}
                attributes={{ [VisAxisSelectors.tick]: { "data-tone": (v: number) => tickTone(Number(v)) } }} />
              <For each={model()!.markers ?? []}>{(mk) => (
                <VisPlotline<Row> axis="x" value={mk.at} color={MARKER[mk.kind].color} lineWidth={mk.kind === "today" ? 1.5 : 1} lineStyle={PlotlineLineStylePresets.Solid} duration={0} />
              )}</For>
              <Index each={g().series.filter((s) => s.area)}>{(s) => (
                <VisArea<Pt> data={s().data.filter((p) => p.y != null)} x={(d: Pt) => d.x} y={(d: Pt) => d.y ?? undefined} color={s().color} opacity={0.08} duration={0} excludeFromDomainCalculation />
              )}</Index>
              <Show when={!g().grouped && model()!.bars?.length}>
                <VisStackedBar<Row> data={g().rows} x={(d: Row) => d.x} y={(d: Row) => d.bar || undefined} color={(d: Row) => d.color ?? INKS.spend}
                  barWidth={g().groupW} barMaxWidth={g().groupW} roundedCorners={3} duration={0} excludeFromDomainCalculation
                  events={{ [VisStackedBarSelectors.bar]: { click: (d: Row) => props.onPick?.(d.x) } }} />
              </Show>
              <Show when={g().grouped}>
                <VisGroupedBar<Row> data={g().rows} x={(d: Row) => d.x} y={[(d: Row) => d.in || undefined, (d: Row) => d.out || undefined]} barMinHeight={0} color={(_: Row, i: number) => barColors[i]!}
                  groupWidth={g().groupW} groupMaxWidth={g().groupW} barPadding={0.08} roundedCorners={3} duration={0} excludeFromDomainCalculation
                  events={{ [VisGroupedBarSelectors.bar]: { click: (d: Row) => props.onPick?.(d.x) } }} />
              </Show>
              <Index each={[...g().ruleSeries, ...g().series]}>{(s) => (
                <VisLine<Pt> data={s().data} x={(d: Pt) => d.x} y={(d: Pt) => d.y ?? undefined} color={s().color} lineWidth={s().width}
                  lineDashArray={DASH_ARRAY[s().style as LineStyle]} curveType={CurveType.Linear} duration={0} excludeFromDomainCalculation />
              )}</Index>
              <Show when={g().points.length}>
                <VisScatter<{ x: number; y: number; color: string; over: boolean }> data={g().points} x={(d) => d.x} y={(d) => d.y} color={(d) => d.color}
                  size={8} shape={(d) => (d.over ? "triangle" : "circle")} strokeColor="var(--background)" strokeWidth={2} duration={0} excludeFromDomainCalculation />
              </Show>
              <VisAnnotations items={g().items} />
              <VisCrosshair<Row> data={g().rows} x={(d: Row) => d.x} y={() => 0} snapToData
                getCircles={(x: number | Date) => {
                  const i = Math.round(Number(x))
                  return g().circleSeries.flatMap((s) => (s.values[i] == null ? [] : [{ y: g().yAt(s.values[i]!), color: s.color, strokeColor: "var(--background)", strokeWidth: 2 }]))
                }}
                template={(d: Row) => { const t = model()?.tip?.(d.x); return t ? tipHtml(t) : "" }} />
              {/* Beside the pointer; on a phone over the finger, where the hand doesn't cover it. */}
              <Show when={compact()} fallback={<VisTooltip horizontalShift={14} verticalShift={0} />}>
                <VisTooltip horizontalPlacement={Position.Center} verticalPlacement={Position.Top} verticalShift={36} />
              </Show>
            </VisXYContainer>
          )
        }}</Show>
      </div>
      <Legend items={model()?.legend ?? []} />
    </div>
  )
}

/** A series' mark: a short line (solid, dotted, dashed) or a bar. */
export function Swatch(props: { color: string; style?: LineStyle | "bar" }) {
  return (
    <Show when={props.style !== "bar"} fallback={<span class="swatch bar" style={{ background: props.color }} />}>
      <svg class="swatch line" width="16" height="8" viewBox="0 0 16 8" aria-hidden="true">
        <line x1="2" x2="14" y1="4" y2="4" stroke={props.color} stroke-width="2" stroke-linecap="round" stroke-dasharray={DASH[(props.style as LineStyle) ?? "solid"]} />
      </svg>
    </Show>
  )
}

/** A chart's legend: each series' mark and what it is, with its figures. */
export function Legend(props: { items: LegendItem[] }) {
  return (
    <div class="legend">
      <For each={props.items}>{(item) => (
        <span class="item" title={item.title}>
          <Show when={item.mark}>{(mark) => (
            <Show when={mark().kind === "swatches"} fallback={<Swatch color={mark().color} style={mark().kind === "bar" ? "bar" : mark().style} />}>
              <span class="swatches"><For each={mark().colors ?? []}>{(c) => <span class="swatch bar" style={{ background: c }} />}</For></span>
            </Show>
          )}</Show>
          <span><For each={item.parts}>{(part) => <span class={part.cls}>{part.text}</span>}</For></span>
        </span>
      )}</For>
    </div>
  )
}
