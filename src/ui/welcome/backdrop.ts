import type { StyledSpan } from "../primitives/StyledLine"

/** The welcome page's backdrops (Settings › Appearance). */
export const BACKDROPS = [
  { id: "plasma", label: "plasma" },
  { id: "coins", label: "coin rain" },
  { id: "ticker", label: "ticker tape" },
] as const
export type BackdropId = (typeof BACKDROPS)[number]["id"]
export const DEFAULT_BACKDROP: BackdropId = "plasma"

/** How bright a backdrop's mark is, 0 (barely there) to LEVELS - 1; and the
 * tints for a rise and a fall. The welcome screen picks the colours. */
export const BACKDROP_LEVELS = 6
export interface BackdropInk { level: (level: number) => string; up: string; down: string }

/**
 * The welcome page's backdrop, full screen, behind everything. Pure: the
 * lines for a `width`×`height` screen `t` seconds in. Neighbouring cells of
 * one colour share a span.
 */
export function backdropLines(id: BackdropId, width: number, height: number, t: number, ink: BackdropInk): StyledSpan[][] {
  const cell = id === "coins" ? coinRain(width, height, t, ink) : id === "ticker" ? tickerTape(width, height, t, ink) : plasma(width, height, t, ink)
  const lines: StyledSpan[][] = []
  for (let y = 0; y < height; y++) {
    const spans: StyledSpan[] = []
    for (let x = 0; x < width; x++) {
      const { ch, fg } = cell(x, y)
      const last = spans.at(-1)
      if (last && last.fg === fg) last.text += ch
      else spans.push({ text: ch, fg })
    }
    lines.push(spans)
  }
  return lines
}

type Cell = (x: number, y: number) => { ch: string; fg: string }

/** A number in 0..1 from an integer, the same each time (a column's speed). */
const hash = (n: number) => {
  let h = (n * 374761393) ^ 0x5bd1e995
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/**
 * Plasma (the demoscene effect): each cell's value a sum of drifting sine
 * waves; its character climbs a ramp to "$", its colour brightens. The
 * lower half of the range is blank: quiet ground, bright crests.
 */
function plasma(width: number, height: number, t: number, ink: BackdropInk): Cell {
  const RAMP = " ··::++==$"
  const cx = width / 2, cy = height / 2
  return (x, y) => {
    // Cells are about twice as tall as wide: y counts double.
    const dx = x - cx, dy = (y - cy) * 2
    const v = Math.sin(x * 0.07 + t * 0.9) + Math.sin(dy * 0.09 - t * 0.6) + Math.sin((x + dy) * 0.045 + t * 0.4) + Math.sin(Math.sqrt(dx * dx + dy * dy) * 0.11 - t * 1.1)
    const u = Math.max(0, Math.min(1, ((v + 4) / 8 - 0.45) / 0.55)) ** 1.4
    return { ch: RAMP[Math.min(RAMP.length - 1, Math.floor(u * RAMP.length))]!, fg: ink.level(Math.min(BACKDROP_LEVELS - 1, Math.floor(u * BACKDROP_LEVELS))) }
  }
}

/**
 * Coin rain: in about one column in three, a "$" falls at its own speed,
 * trailing digits and cents that fade behind it, then starts again from the
 * top after a pause.
 */
function coinRain(width: number, height: number, t: number, ink: BackdropInk): Cell {
  const TRAIL = "$0123456789¢.,"
  const columns = Array.from({ length: width }, (_, x) => {
    const on = hash(x * 7 + 1) < 0.34
    const speed = 4 + hash(x * 13 + 2) * 9 // rows a second
    const trail = 5 + Math.floor(hash(x * 17 + 3) * 10)
    const cycle = height + trail + 6 + hash(x * 19 + 4) * height
    const head = ((t * speed + hash(x * 23 + 5) * cycle) % cycle) - trail
    return { on, head, trail }
  })
  return (x, y) => {
    const c = columns[x]!
    const back = c.head - y // 0 at the head, more up the trail
    if (!c.on || back < 0 || back > c.trail) return { ch: " ", fg: ink.level(0) }
    const fade = 1 - back / c.trail
    // The trail's characters change as it falls: each row a new one.
    const ch = back < 1 ? "$" : TRAIL[1 + Math.floor(hash(x * 31 + Math.floor(c.head) * 7 + y) * (TRAIL.length - 1))]!
    return { ch, fg: ink.level(back < 1 ? BACKDROP_LEVELS - 1 : Math.max(0, Math.round(fade * (BACKDROP_LEVELS - 2)))) }
  }
}

/** Made-up market lines for the ticker: a name, a price, a change. */
const TICKERS = [
  ["JASK", 12.4, 2.1], ["ACME", 48.15, -0.8], ["UPBK", 3.07, 1.4], ["AUD/USD", 0.6612, 0.2], ["GOLD", 3141.6, 0.6], ["ASX200", 8204.1, -0.3],
  ["COFE", 5.5, 3.2], ["RENT", 650, 1.9], ["GROC", 132.8, -1.1], ["FUEL", 1.89, -2.4], ["SAVE", 100, 0.4], ["BTC", 98110, -3.6],
] as const

/**
 * Ticker tape: every third row a band of made-up tickers scrolling left,
 * each band at its own speed; rises tinted up, falls tinted down. The rows
 * between stay blank.
 */
function tickerTape(width: number, height: number, t: number, ink: BackdropInk): Cell {
  const bands = new Map<number, { text: string; up: boolean[] }>()
  for (let y = 1; y < height; y += 3) {
    const start = Math.floor(hash(y) * TICKERS.length)
    let text = ""
    const up: boolean[] = []
    for (let i = 0; text.length < width * 2 + 40; i++) {
      const [name, price, change] = TICKERS[(start + i) % TICKERS.length]!
      // A little drift on the numbers each lap, so the tape isn't a loop.
      const drift = (hash(y * 101 + i) - 0.5) * 0.6
      const pct = change + drift
      const item = `${name} ${price.toLocaleString("en-AU")} ${pct >= 0 ? "▲" : "▼"}${Math.abs(pct).toFixed(1)}%   ·   `
      text += item
      up.push(...Array.from(item, () => pct >= 0))
    }
    const speed = 3 + hash(y * 3 + 9) * 7 // columns a second
    const offset = Math.floor(t * speed + hash(y * 5) * text.length) % text.length
    bands.set(y, { text: text.slice(offset) + text.slice(0, offset), up: [...up.slice(offset), ...up.slice(0, offset)] })
  }
  return (x, y) => {
    const band = bands.get(y)
    const ch = band?.text[x] ?? " "
    if (ch === " ") return { ch, fg: ink.level(0) }
    if (ch === "▲" || ch === "▼" || /[\d.%,]/.test(ch)) return { ch, fg: band!.up[x] ? ink.up : ink.down }
    return { ch, fg: ink.level(2) }
  }
}
