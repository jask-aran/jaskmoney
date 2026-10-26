/**
 * Braille line charts. Each cell holds a 2×4 grid of dots, so a chart
 * `width` × `height` cells plots on a (2·width) × (4·height) dot canvas.
 * Pure: returns runs of text tagged with an ink key; the caller maps inks to
 * colours.
 */

import { MONTHS, addDays, dayOfWeek, type WeekStart } from "../../domain/days"

export interface LineSeries {
  /** One value per x position; null leaves a gap (e.g. days after today). */
  values: Array<number | null>
  ink: string
  /** Fill the cells below the line with this ink; the line's own cells hold
   * only the line. */
  fill?: string
}

export interface Marker {
  /** X position (index into the series). */
  index: number
  ink: string
}

export interface Run {
  text: string
  ink: string | null
}

// Dot bits by [column][row]: Unicode braille numbering (dots 1-8).
const DOT_BITS = [
  [0x01, 0x02, 0x04, 0x40],
  [0x08, 0x10, 0x20, 0x80],
]

/** Dot column for x position `index` of `length`, spread over `width` cells. */
export function dotColumn(index: number, length: number, width: number): number {
  return length <= 1 ? 0 : Math.round((index * (2 * width - 1)) / (length - 1))
}

/** Cell column for x position `index` of `length`. */
export function cellColumn(index: number, length: number, width: number): number {
  return Math.floor(dotColumn(index, length, width) / 2)
}

/**
 * Draw `series` between `min` (bottom) and `max` (top), connecting consecutive
 * non-null points. A cell shared by two lines shows the one with more dots
 * there (the later on a tie). Markers draw a vertical rule in cells without
 * dots.
 * Returns rows top first, each a list of runs.
 */
export function lineChart(opts: {
  series: LineSeries[]
  length: number
  width: number
  height: number
  min: number
  max: number
  markers?: Marker[]
}): Run[][] {
  const { width, height, length, min } = opts
  if (width <= 0 || height <= 0) return []
  const span = opts.max - min || 1
  const dotsHigh = 4 * height
  // A cell has one colour, so each series (and each fill) draws on its own
  // layer, and a cell shows only one layer's dots: the line with the most
  // dots there (ties to the later series), else a fill. Another line's dots
  // in that cell are dropped rather than drawn in the wrong colour.
  const layers: Array<{ ink: string; fill: boolean; masks: number[] }> = []
  const layer = (ink: string, fill: boolean) => {
    const l = { ink, fill, masks: new Array<number>(width * height).fill(0) }
    layers.push(l)
    return l
  }
  const plot = (l: (typeof layers)[number], x: number, y: number) => {
    if (x < 0 || x >= 2 * width || y < 0 || y >= dotsHigh) return
    l.masks[Math.floor(y / 4) * width + Math.floor(x / 2)]! |= DOT_BITS[x % 2]![y % 4]!
  }
  const dotRow = (v: number) => {
    const level = Math.round(((v - min) / span) * (dotsHigh - 1))
    return dotsHigh - 1 - Math.max(0, Math.min(dotsHigh - 1, level))
  }
  for (const s of opts.series) {
    const dots: Array<[number, number]> = []
    let prev: [number, number] | null = null
    for (let i = 0; i < length; i++) {
      const v = s.values[i]
      if (v == null) { prev = null; continue }
      const point: [number, number] = [dotColumn(i, length, width), dotRow(v)]
      if (prev) line(prev, point, (x, y) => dots.push([x, y]))
      else dots.push(point)
      prev = point
    }
    if (s.fill) {
      // From the cell row below the line's lowest dot in each dot column down
      // to the floor, so the line's own cells hold only the line.
      const f = layer(s.fill, true)
      const lowest = new Map<number, number>()
      for (const [x, y] of dots) lowest.set(x, Math.max(lowest.get(x) ?? -1, y))
      for (const [x, y] of lowest) for (let yy = (Math.floor(y / 4) + 1) * 4; yy < dotsHigh; yy++) plot(f, x, yy)
    }
    const l = layer(s.ink, false)
    for (const [x, y] of dots) plot(l, x, y)
  }
  const bits = (mask: number) => { let n = 0; for (let m = mask; m; m &= m - 1) n++; return n }
  const masks = new Array<number>(width * height).fill(0)
  const inks = new Array<string | null>(width * height).fill(null)
  for (let cell = 0; cell < width * height; cell++) {
    let best: (typeof layers)[number] | null = null
    for (const l of layers) {
      const m = l.masks[cell]!
      if (!m) continue
      if (!best || (best.fill && !l.fill) || (best.fill === l.fill && bits(m) >= bits(best.masks[cell]!))) best = l
    }
    if (best) { masks[cell] = best.masks[cell]!; inks[cell] = best.ink }
  }
  const markerInk = new Map<number, string>()
  for (const m of opts.markers ?? []) {
    if (m.index >= 0 && m.index < length) markerInk.set(cellColumn(m.index, length, width), m.ink)
  }
  const rows: Run[][] = []
  for (let r = 0; r < height; r++) {
    const runs: Run[] = []
    for (let c = 0; c < width; c++) {
      const mask = masks[r * width + c]!
      const marker = markerInk.get(c)
      const [text, ink] = mask ? [String.fromCharCode(0x2800 + mask), inks[r * width + c]!]
        : marker ? ["│", marker] : [" ", null]
      const last = runs[runs.length - 1]
      if (last && last.ink === ink) last.text += text
      else runs.push({ text, ink })
    }
    rows.push(runs)
  }
  return rows
}

/** Bresenham between two dot positions, inclusive. */
function line([x0, y0]: [number, number], [x1, y1]: [number, number], plot: (x: number, y: number) => void) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0)
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx + dy
  for (;;) {
    plot(x0, y0)
    if (x0 === x1 && y0 === y1) return
    const e2 = 2 * err
    if (e2 >= dy) { err += dy; x0 += sx }
    if (e2 <= dx) { err += dx; y0 += sy }
  }
}

/** The cell (row top first, column) holding point `index` of `length` at
 * `value`, on a chart drawn by lineChart with the same bounds. */
export function pointCell(index: number, value: number, length: number, width: number, height: number, min: number, max: number): { row: number; col: number } {
  return { row: valueRow(value, min, max, height), col: cellColumn(index, length, width) }
}

/**
 * A round axis ceiling for `max` and its tick step, at most `ticks` steps
 * (1, 2, 2.5 or 5 × 10^k per step).
 */
export function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 1 }
  const raw = max / ticks
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= raw)!
  return { max: Math.ceil(max / step - 1e-9) * step, step }
}

/**
 * Cell row (top first) whose dots hold `value` on a `height`-row chart
 * between `min` and `max`; matches the rows `lineChart` plots on.
 */
export function valueRow(value: number, min: number, max: number, height: number): number {
  const dotsHigh = 4 * height
  const level = Math.round(((value - min) / (max - min || 1)) * (dotsHigh - 1))
  return Math.floor((dotsHigh - 1 - Math.max(0, Math.min(dotsHigh - 1, level))) / 4)
}

/**
 * Gridlines and the x-axis label line for a daily series over `dates`, as in
 * the Go app: month starts ("year" on 1 Jan) and the range's closing month
 * end; week rules on the week-start day when weeks are at least 6 cells apart, else on
 * days 7, 14 and 21 of each month, thinning to 7 and 21, then 14, as months
 * narrow (unlabelled); and today, which replaces a rule on its day.
 * Labels are placed greedily by priority (start and end, then months, then
 * week-start day numbers) with at least two blank cells between them. `colOf`
 * places date index i (default: the line chart's spread over `width`).
 */
export function dateAxis(
  dates: string[],
  width: number,
  todayISO: string,
  colOf: (index: number) => number = (i) => cellColumn(i, dates.length, width),
  weekStart: WeekStart = "monday",
): { markers: Marker[]; labels: string } {
  const n = dates.length
  const markers: Marker[] = []
  const labelAt: Array<{ col: number; text: string; align: "left" | "right" | "center" }> = []
  if (n === 0 || width <= 0) return { markers, labels: "" }
  const weekCells = (7 * width) / Math.max(1, n)
  const day = (iso: string) => Number(iso.slice(8, 10))
  const month = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""
  const weekday = (iso: string) => dayOfWeek(iso, weekStart)
  const cross = dates[0]!.slice(0, 4) !== dates[n - 1]!.slice(0, 4)
  const dayLabel = (iso: string) => `${day(iso)} ${month(iso)}${cross ? ` ${iso.slice(2, 4)}` : ""}`
  labelAt.push({ col: 0, text: dayLabel(dates[0]!), align: "left" })
  labelAt.push({ col: width - 1, text: dayLabel(dates[n - 1]!), align: "right" })
  const colsPerMonth = width / new Set(dates.map((iso) => iso.slice(0, 7))).size
  const weekDays = weekCells >= 6 ? [] : colsPerMonth >= 14 ? [7, 14, 21] : colsPerMonth >= 9 ? [7, 21] : colsPerMonth >= 5 ? [14] : []
  const months: number[] = []
  const weekStarts: number[] = []
  dates.forEach((iso, i) => {
    if (i === 0) return
    if (day(iso) === 1) months.push(i)
    else if (weekCells >= 6 && weekday(iso) === 0) weekStarts.push(i)
    else if (weekDays.includes(day(iso))) markers.push({ index: i, ink: "week" })
  })
  const yearInk = (iso: string) => (iso.slice(5, 7) === "01" ? "year" : "month")
  for (const i of months) {
    const iso = dates[i]!
    markers.push({ index: i, ink: yearInk(iso) })
    labelAt.push({ col: colOf(i), text: iso.slice(5, 7) === "01" ? iso.slice(0, 4) : month(iso), align: "left" })
  }
  // The closing month end, when the range ends on one.
  const lastISO = dates[n - 1]!
  if (n > 1 && day(addDays(lastISO, 1)) === 1) markers.push({ index: n - 1, ink: yearInk(addDays(lastISO, 1)) })
  for (const i of weekStarts) {
    markers.push({ index: i, ink: "week" })
    labelAt.push({ col: colOf(i), text: String(day(dates[i]!)), align: "left" })
  }
  const today = dates.indexOf(todayISO)
  if (today > 0 && today <= n - 1) {
    // Today's rule replaces a week or month rule on the same day.
    for (let i = markers.length - 1; i >= 0; i--) if (markers[i]!.index === today) markers.splice(i, 1)
    markers.push({ index: today, ink: "today" })
  }
  const line = new Array<string>(width).fill(" ")
  const taken = new Array<boolean>(width).fill(false)
  for (const label of labelAt) {
    const start = label.align === "right" ? label.col - label.text.length + 1 : label.col
    const end = start + label.text.length
    if (start < 0 || end > width) continue
    let free = true
    for (let c = Math.max(0, start - 2); c < Math.min(width, end + 2); c++) if (taken[c]) free = false
    if (!free) continue
    for (let c = start; c < end; c++) { line[c] = label.text[c - start]!; taken[c] = true }
  }
  return { markers, labels: line.join("") }
}

/** Round axis bounds around `lo`..`hi` with their tick step (see niceScale).
 * A flat series gets a band around its value. */
export function niceRange(lo: number, hi: number, ticks = 4): { min: number; max: number; step: number } {
  const spread = hi - lo || Math.abs(hi) || 1
  const { step } = niceScale(spread, ticks)
  const min = Math.floor(lo / step + 1e-9) * step
  let max = Math.ceil(hi / step - 1e-9) * step
  if (max <= min) max = min + step
  return { min, max, step }
}

/** Axis bounds for a level series drawn over `rows` cell rows: the series'
 * own low and high with a row of headroom each side, so the line never sits
 * on the plot's floor or ceiling; with `zero`, the bounds also take in $0.
 * Ticks fall on the step's multiples between the bounds. A flat series gets
 * a band around its value (see niceRange). */
export function fitRange(lo: number, hi: number, rows: number, zero = false): { min: number; max: number; step: number } {
  if (zero) [lo, hi] = [Math.min(0, lo), Math.max(0, hi)]
  if (hi === lo) return niceRange(lo, hi)
  // pad / (spread + 2 pad) = 1 / rows; $0 itself needs no headroom.
  const pad = rows > 2 ? (hi - lo) / (rows - 2) : 0
  const min = zero && lo === 0 ? 0 : lo - pad
  const max = zero && hi === 0 ? 0 : hi + pad
  return { min, max, step: niceScale(max - min).step }
}

/** Axis label per cell row (top first) for each multiple of `step` from
 * `min` to `max`; when two ticks share a row the higher one wins. */
export function tickRows(min: number, max: number, step: number, height: number, format: (v: number) => string): Map<number, string> {
  const rows = new Map<number, string>()
  for (let k = Math.ceil(min / step - 1e-9); k * step <= max + step * 1e-9; k++) rows.set(valueRow(k * step, min, max, height), format(k * step))
  return rows
}
