/**
 * Braille line charts. Each cell holds a 2×4 grid of dots, so a chart
 * `width` × `height` cells plots on a (2·width) × (4·height) dot canvas.
 * Pure: returns runs of text tagged with an ink key; the caller maps inks to
 * colours.
 */

export interface LineSeries {
  /** One value per x position; null leaves a gap (e.g. days after today). */
  values: Array<number | null>
  ink: string
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
 * Draw `series` (in order; a later series owns a cell it shares with an
 * earlier one) between `min` (bottom) and `max` (top), connecting consecutive
 * non-null points. Markers draw a vertical rule in cells without dots.
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
  const masks = new Array<number>(width * height).fill(0)
  const inks = new Array<string | null>(width * height).fill(null)
  const plot = (x: number, y: number, ink: string) => {
    if (x < 0 || x >= 2 * width || y < 0 || y >= dotsHigh) return
    const cell = Math.floor(y / 4) * width + Math.floor(x / 2)
    masks[cell]! |= DOT_BITS[x % 2]![y % 4]!
    inks[cell] = ink
  }
  const dotRow = (v: number) => {
    const level = Math.round(((v - min) / span) * (dotsHigh - 1))
    return dotsHigh - 1 - Math.max(0, Math.min(dotsHigh - 1, level))
  }
  for (const s of opts.series) {
    let prev: [number, number] | null = null
    for (let i = 0; i < length; i++) {
      const v = s.values[i]
      if (v == null) { prev = null; continue }
      const point: [number, number] = [dotColumn(i, length, width), dotRow(v)]
      if (prev) line(prev, point, (x, y) => plot(x, y, s.ink))
      else plot(point[0], point[1], s.ink)
      prev = point
    }
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

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/**
 * Gridlines and the x-axis label line for a daily series over `dates`:
 * month starts, Mondays when weeks are at least 6 cells apart, and today.
 * Labels are placed greedily by priority (start and end, then months, then
 * Mondays' day numbers) with at least one blank cell between them.
 */
export function dateAxis(dates: string[], width: number, todayISO: string): { markers: Marker[]; labels: string } {
  const n = dates.length
  const markers: Marker[] = []
  const labelAt: Array<{ col: number; text: string; align: "left" | "right" | "center" }> = []
  if (n === 0 || width <= 0) return { markers, labels: "" }
  const weekCells = (7 * width) / Math.max(1, n)
  const day = (iso: string) => Number(iso.slice(8, 10))
  const month = (iso: string) => MONTHS[Number(iso.slice(5, 7)) - 1] ?? ""
  const weekday = (iso: string) => (new Date(iso + "T12:00:00Z").getUTCDay() + 6) % 7
  const cross = dates[0]!.slice(0, 4) !== dates[n - 1]!.slice(0, 4)
  const dayLabel = (iso: string) => `${day(iso)} ${month(iso)}${cross ? ` ${iso.slice(2, 4)}` : ""}`
  labelAt.push({ col: 0, text: dayLabel(dates[0]!), align: "left" })
  labelAt.push({ col: width - 1, text: dayLabel(dates[n - 1]!), align: "right" })
  const months: number[] = []
  const mondays: number[] = []
  dates.forEach((iso, i) => {
    if (i === 0) return
    if (day(iso) === 1) months.push(i)
    else if (weekCells >= 6 && weekday(iso) === 0) mondays.push(i)
  })
  for (const i of months) {
    markers.push({ index: i, ink: "month" })
    const iso = dates[i]!
    labelAt.push({ col: cellColumn(i, n, width), text: iso.slice(5, 7) === "01" ? iso.slice(0, 4) : month(iso), align: "left" })
  }
  for (const i of mondays) {
    markers.push({ index: i, ink: "week" })
    labelAt.push({ col: cellColumn(i, n, width), text: String(day(dates[i]!)), align: "left" })
  }
  const today = dates.indexOf(todayISO)
  if (today > 0 && today < n - 1) markers.push({ index: today, ink: "today" })
  const line = new Array<string>(width).fill(" ")
  const taken = new Array<boolean>(width).fill(false)
  for (const label of labelAt) {
    const start = label.align === "right" ? label.col - label.text.length + 1 : label.col
    const end = start + label.text.length
    if (start < 0 || end > width) continue
    let free = true
    for (let c = Math.max(0, start - 1); c < Math.min(width, end + 1); c++) if (taken[c]) free = false
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

/** Axis label per cell row (top first) for each tick from `min` to `max`;
 * when two ticks share a row the higher one wins. */
export function tickRows(min: number, max: number, step: number, height: number, format: (v: number) => string): Map<number, string> {
  const rows = new Map<number, string>()
  for (let v = min; v <= max + step * 1e-9; v += step) rows.set(valueRow(v, min, max, height), format(v))
  return rows
}
