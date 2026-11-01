import type { StyledSpan } from "../primitives/StyledLine"

/**
 * The welcome page's backdrop: a slow plasma of money marks, full screen,
 * behind everything. Pure: the lines for a `width`×`height` screen `t`
 * seconds in. Each cell's value is a sum of waves; its character climbs
 * a ramp to "$" and its colour from `dim` toward `bright` (quantised, so
 * neighbours share a span).
 */
const RAMP = " ··::++==$"
const LEVELS = 6

export function backdropLines(width: number, height: number, t: number, colour: (level: number) => string): StyledSpan[][] {
  const cx = width / 2, cy = height / 2
  const lines: StyledSpan[][] = []
  for (let y = 0; y < height; y++) {
    const spans: StyledSpan[] = []
    for (let x = 0; x < width; x++) {
      // Cells are about twice as tall as wide: y counts double.
      const dx = x - cx, dy = (y - cy) * 2
      const v = Math.sin(x * 0.07 + t * 0.9) + Math.sin(dy * 0.09 - t * 0.6) + Math.sin((x + dy) * 0.045 + t * 0.4) + Math.sin(Math.sqrt(dx * dx + dy * dy) * 0.11 - t * 1.1)
      // -4..4 → 0..1; the lower half blank, the rest steepened: quiet
      // ground, bright crests.
      const u = Math.max(0, Math.min(1, ((v + 4) / 8 - 0.45) / 0.55)) ** 1.4
      const ch = RAMP[Math.min(RAMP.length - 1, Math.floor(u * RAMP.length))]!
      const fg = colour(Math.min(LEVELS - 1, Math.floor(u * LEVELS)))
      const last = spans.at(-1)
      if (last && last.fg === fg) last.text += ch
      else spans.push({ text: ch, fg })
    }
    lines.push(spans)
  }
  return lines
}

export const BACKDROP_LEVELS = LEVELS
