/**
 * Arrow-key travel between panes: from the focused region's rectangle, the
 * nearest region that lies wholly in the arrow's direction. Pure geometry
 * over the rectangles the panes rendered at (screen cells), so the map is
 * the layout itself, at any terminal size.
 *
 * A region in the beam (overlapping the source across the arrow: the same
 * row for left/right, the same columns for up/down) beats any outside it,
 * so a pane straight ahead wins over a nearer one off to the side. Then the
 * score: the gap along the arrow plus twice the gap across it. Ties go to
 * the one further up, then left.
 * Nothing in that direction: null (the focus stays; it never wraps).
 */
export interface Rect { x: number; y: number; width: number; height: number }
export type Direction = "up" | "down" | "left" | "right"

export function nearestRegion<Id>(from: Rect, regions: readonly { id: Id; rect: Rect }[], dir: Direction): Id | null {
  let best: { id: Id; beam: boolean; score: number; rect: Rect } | null = null
  for (const { id, rect } of regions) {
    const along = gapAlong(from, rect, dir)
    if (along == null) continue
    const across = dir === "up" || dir === "down" ? gap(from.x, from.width, rect.x, rect.width) : gap(from.y, from.height, rect.y, rect.height)
    const beam = across === 0, score = along + 2 * across
    const better = !best || (beam !== best.beam ? beam
      : score !== best.score ? score < best.score
      : rect.y !== best.rect.y ? rect.y < best.rect.y : rect.x < best.rect.x)
    if (better) best = { id, beam, score, rect }
  }
  return best?.id ?? null
}

/** How far `to` lies past `from` in `dir`, or null when it isn't wholly there. */
function gapAlong(from: Rect, to: Rect, dir: Direction): number | null {
  const d = dir === "up" ? from.y - (to.y + to.height)
    : dir === "down" ? to.y - (from.y + from.height)
    : dir === "left" ? from.x - (to.x + to.width)
    : to.x - (from.x + from.width)
  return d >= 0 ? d : null
}

/** The gap between two spans on one axis; 0 when they overlap. */
function gap(a: number, aLen: number, b: number, bLen: number): number {
  return Math.max(0, b - (a + aLen), a - (b + bLen))
}
