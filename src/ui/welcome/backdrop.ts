import type { StyledSpan } from "../primitives/StyledLine"
import type { Ticker } from "../../app/tickers"

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
/** `tickers`: the tape's real prices, once they've come. `t` is seconds
 * since this backdrop began (a tape streams in from empty). */
export function backdropLines(id: BackdropId, width: number, height: number, t: number, ink: BackdropInk, tickers?: readonly Ticker[]): StyledSpan[][] {
  const cell = id === "coins" ? coinRain(width, height, t, ink) : id === "ticker" ? tickerTape(width, height, t, ink, tickers) : plasma(width, height, t, ink)
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

/** Made-up market lines, for when the real ones (app/tickers) can't be had. */
const FAKE_TICKERS: Ticker[] = ([
  ["ASX200", 8204.1, -0.3], ["JASK", 12.4, 2.1], ["ACME", 48.15, -0.8], ["UPBK", 3.07, 1.4], ["AUD/USD", 0.6612, 0.2], ["GOLD", 3141.6, 0.6],
  ["COFE", 5.5, 3.2], ["RENT", 650, 1.9], ["GROC", 132.8, -1.1], ["FUEL", 1.89, -2.4], ["SAVE", 100, 0.4], ["BTC", 98110, -3.6],
  ["AVO", 2.95, -0.7], ["TOAST", 18.5, 0.9], ["BREW", 6.2, 1.1], ["NETF", 18.99, 0], ["GYM", 59.9, -0.2], ["PHONE", 29, 0.3],
  ["POWR", 93.97, 4.1], ["TRAM", 5.3, 0.6], ["PIZZ", 24.5, -1.8], ["BOOK", 32.99, 0.8], ["VET", 145, 2.6], ["HOLS", 1400, -4.2],
] as const).map(([name, price, change]) => ({ name, price, change }))

/** A price as a tape shows it: big ones whole-ish, small ones to four places. */
const price = (p: number) => (p >= 1000 ? p.toLocaleString("en-AU", { maximumFractionDigits: 1 }) : p >= 1 ? p.toFixed(2) : p.toFixed(4))

/** A ticker's slot on a tape: the same width whatever its numbers, so a
 * refresh changes the numbers in place and nothing moves. */
const SLOT = 24
const GAP = "   ·   "
const slotText = (k: Ticker) => `${k.name} ${price(k.price)} ${k.change >= 0 ? "▲" : "▼"}${Math.abs(k.change).toFixed(1)}%`.padEnd(SLOT).slice(0, SLOT) + GAP
/** Seconds of empty tape before the first ticker comes on screen, about:
 * the first ask for real prices has answered by then. */
const LEAD_SECONDS = 1.2

/**
 * Ticker tape: every fourth row a tape of tickers creeping in from the
 * right, each at its own speed (spread by the golden ratio, so no two
 * match) and starting at its own place in the list. `t` is seconds since
 * the tape began: it begins empty and fills from the right, then runs on.
 * Rises tinted up, falls tinted down. `tickers`: real prices once they've
 * come, else made-up ones.
 */
function tickerTape(width: number, height: number, t: number, ink: BackdropInk, tickers: readonly Ticker[] = FAKE_TICKERS): Cell {
  const list = tickers.length ? tickers : FAKE_TICKERS
  const cycle = SLOT + GAP.length
  const bands = new Map<number, (x: number) => { ch: string; up: boolean } | null>()
  for (let y = 1, k = 0; y < height; y += 4, k++) {
    // 2 to 11 columns a second: under half a column a frame at 30.
    const speed = 2 + ((k * 0.618034) % 1) * 9
    // How far the tape has come in from the right edge: after its lead-in
    // (each tape's a little different, so they don't arrive together) it
    // creeps in at its own speed, the speed it keeps.
    const u = t - (LEAD_SECONDS + hash(k * 7 + 3) * 0.8)
    const head = u < 0 ? -1 : Math.floor(u * speed)
    const first = (k * 5) % list.length
    bands.set(y, (x) => {
      // The tape's position under column x: 0 is its first character.
      const i = head - (width - 1 - x)
      if (i < 0) return null
      const ticker = list[(first + Math.floor(i / cycle)) % list.length]!
      const ch = slotText(ticker)[i % cycle]!
      return { ch, up: ticker.change >= 0 }
    })
  }
  return (x, y) => {
    const at = bands.get(y)?.(x)
    if (!at || at.ch === " ") return { ch: " ", fg: ink.level(0) }
    if (at.ch === "▲" || at.ch === "▼" || /[\d.%,]/.test(at.ch)) return { ch: at.ch, fg: at.up ? ink.up : ink.down }
    return { ch: at.ch, fg: ink.level(2) }
  }
}
