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

function gapAlong(from: Rect, to: Rect, dir: Direction): number | null {
  const d = dir === "up" ? from.y - (to.y + to.height)
    : dir === "down" ? to.y - (from.y + from.height)
    : dir === "left" ? from.x - (to.x + to.width)
    : to.x - (from.x + from.width)
  return d >= 0 ? d : null
}

function gap(a: number, aLen: number, b: number, bLen: number): number {
  return Math.max(0, b - (a + aLen), a - (b + bLen))
}
