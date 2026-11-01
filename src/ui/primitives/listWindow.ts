/** A window measured in cells, with its cursor entry fully visible.
 * An entry taller than rows gets its own window. End is exclusive. */
export function visibleWindow(heights: readonly number[], cursor: number, rows: number): { start: number; end: number } {
  if (!heights.length) return { start: 0, end: 0 }
  const at = Math.max(0, Math.min(heights.length - 1, cursor))
  const capacity = Math.max(1, rows, heights[at]!)
  let start = at, end = at + 1, used = heights[at]!
  let before = 0
  while (start > 0 && before + heights[start - 1]! <= Math.floor(capacity / 2) && used + heights[start - 1]! <= capacity) {
    before += heights[--start]!
    used += heights[start]!
  }
  while (end < heights.length && used + heights[end]! <= capacity) used += heights[end++]!
  while (start > 0 && used + heights[start - 1]! <= capacity) used += heights[--start]!
  return { start, end }
}
