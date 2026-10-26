/** Pure text-chart builders for the dashboard. Each returns plain strings;
 * colouring is the caller's job. */

const EIGHTHS = ["", "▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"]

/** Average `values` into `width` buckets, one value per column when there are
 * fewer values than columns. Averaging (not summing) keeps buckets that hold
 * 3 or 4 days comparable. */
export function bucket(values: number[], width: number): number[] {
  if (width <= 0) return []
  if (values.length <= width) return [...values]
  const sums = new Array<number>(width).fill(0)
  const counts = new Array<number>(width).fill(0)
  values.forEach((v, i) => {
    const b = Math.min(width - 1, Math.floor((i * width) / values.length))
    sums[b]! += v
    counts[b]!++
  })
  return sums.map((sum, b) => sum / Math.max(1, counts[b]!))
}

/** Spread fewer values than columns across the width: each value becomes a
 * bar `floor(width / n)` columns wide, with a one-column gap when bars are at
 * least three columns wide. Gaps are encoded as -1 (blank). */
function widen(values: number[], width: number): number[] {
  if (values.length === 0 || values.length >= width) return values
  const per = Math.floor(width / values.length)
  if (per <= 1) return values
  return values.flatMap((v) => [...new Array<number>(per >= 3 ? per - 1 : per).fill(v), ...(per >= 3 ? [-1] : [])])
}

/**
 * Vertical bar chart, `height` rows tall, one column per bucket, eighth-block
 * resolution. Rows are returned top first. Zero stays blank; any positive
 * value shows at least one eighth so small days remain visible.
 */
export function barChart(values: number[], width: number, height: number): string[] {
  const cols = widen(bucket(values, width), width)
  const max = Math.max(0, ...cols)
  const levels = cols.map((v) => (v <= 0 || max === 0 ? 0 : Math.max(1, Math.round((v / max) * height * 8))))
  const rows: string[] = []
  for (let r = height - 1; r >= 0; r--) {
    rows.push(levels.map((l) => EIGHTHS[Math.max(0, Math.min(8, l - r * 8))] || " ").join(""))
  }
  return rows
}

/**
 * Area chart of a level series (e.g. net position): like `barChart` but the
 * baseline is the series minimum minus a margin, so movement is visible
 * instead of every column being nearly full. Uses the last value of each
 * bucket rather than the sum.
 */
export function levelChart(values: number[], width: number, height: number): { rows: string[]; min: number; max: number } {
  if (values.length === 0 || width <= 0) return { rows: [], min: 0, max: 0 }
  // Sample the series across the full width: each column shows the value at
  // the end of its slice, so the last column is always the latest value.
  const cols: number[] = []
  for (let c = 0; c < width; c++) cols.push(values[Math.min(values.length - 1, Math.max(0, Math.ceil(((c + 1) * values.length) / width) - 1))]!)
  const lo = Math.min(...cols), hi = Math.max(...cols)
  const base = lo - (hi - lo) * 0.1
  const span = hi - base || 1
  const levels = cols.map((v) => Math.max(1, Math.round(((v - base) / span) * height * 8)))
  const rows: string[] = []
  for (let r = height - 1; r >= 0; r--) {
    rows.push(levels.map((l) => EIGHTHS[Math.max(0, Math.min(8, l - r * 8))] || " ").join(""))
  }
  return { rows, min: lo, max: hi }
}
