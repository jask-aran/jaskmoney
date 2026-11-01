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

/** Made-up market lines, by kind, for when the real ones (app/tickers)
 * can't be had. */
const FAKE_TICKERS: Ticker[] = ([
  ["ASX200", 8204.1, -0.3, "Indices"], ["S&P500", 6120.4, 0.4, "Indices"], ["NIKKEI", 38410, -0.6, "Indices"], ["FTSE", 8290.2, 0.2, "Indices"],
  ["JASK", 12.4, 2.1, "ASX"], ["ACME", 48.15, -0.8, "ASX"], ["UPBK", 3.07, 1.4, "ASX"], ["COFE", 5.5, 3.2, "ASX"], ["GROC", 132.8, -1.1, "ASX"], ["RENT", 650, 1.9, "ASX"],
  ["AVO", 2.95, -0.7, "US"], ["TOAST", 18.5, 0.9, "US"], ["BREW", 6.2, 1.1, "US"], ["NETF", 18.99, 0, "US"], ["PIZZ", 24.5, -1.8, "US"],
  ["AUD/USD", 0.6612, 0.2, "FX"], ["AUD/EUR", 0.6105, -0.1, "FX"], ["AUD/JPY", 101.2, 0.3, "FX"], ["AUD/NZD", 1.0912, 0.1, "FX"],
  ["BTC", 98110, -3.6, "Crypto"], ["ETH", 3420.5, 1.2, "Crypto"], ["SOL", 210.4, 4.4, "Crypto"],
  ["GOLD", 3141.6, 0.6, "Commodities"], ["OIL", 98.4, -1.2, "Commodities"], ["COFFEE", 312.5, 2.3, "Commodities"], ["FUEL", 1.89, -2.4, "Commodities"],
] as const).map(([name, price, change, group]) => ({ name, price, change, group }))

/** A price as a tape shows it: a currency pair to four places (two past
 * 100: yen); else big ones whole-ish, small ones to four places. */
const price = (k: Ticker) => {
  const p = k.price
  if (k.group === "FX") return p.toFixed(p >= 100 ? 2 : 4)
  return p >= 1000 ? p.toLocaleString("en-AU", { maximumFractionDigits: 1 }) : p >= 1 ? p.toFixed(2) : p.toFixed(4)
}

/** A ticker's slot on a tape: the same width whatever its numbers, so a
 * refresh changes the numbers in place and nothing moves; spaces between. */
const SLOT = 24
const GAP = "      "
const slotText = (k: Ticker) => `${k.name} ${price(k)} ${k.change >= 0 ? "▲" : "▼"}${Math.abs(k.change).toFixed(1)}%`.padEnd(SLOT).slice(0, SLOT) + GAP
/** Seconds of empty tape before the first ticker comes on screen, about:
 * the first ask for real prices has answered by then. */
const LEAD_SECONDS = 1.2

/**
 * Ticker tape: every fourth row a tape of tickers of one kind (indices,
 * ASX shares, US shares, FX, crypto, commodities: the kinds in turn down
 * the screen), creeping in from the right, each tape at its own speed
 * (spread by the golden ratio, so no two match) and starting at its own
 * place in its kind. `t` is seconds since the tape began: it begins empty
 * and fills from the right, then runs on. A name is dim; its price and
 * change are tinted up or down. `tickers`: real prices once they've come,
 * else made-up ones.
 */
function tickerTape(width: number, height: number, t: number, ink: BackdropInk, tickers: readonly Ticker[] = FAKE_TICKERS): Cell {
  const list = tickers.length ? tickers : FAKE_TICKERS
  const kinds = [...new Set(list.map((k) => k.group))]
  const cycle = SLOT + GAP.length
  const bands = new Map<number, (x: number) => { ch: string; up: boolean; name: boolean } | null>()
  for (let y = 1, k = 0; y < height; y += 4, k++) {
    const kind = list.filter((tk) => tk.group === kinds[k % kinds.length])
    // 2 to 11 columns a second: under half a column a frame at 30.
    const speed = 2 + ((k * 0.618034) % 1) * 9
    // How far the tape has come in from the right edge: after its lead-in
    // (each tape's a little different, so they don't arrive together) it
    // creeps in at its own speed, the speed it keeps.
    const u = t - (LEAD_SECONDS + hash(k * 7 + 3) * 0.8)
    const head = u < 0 ? -1 : Math.floor(u * speed)
    // A kind's second tape starts further along it.
    const first = Math.floor(k / kinds.length) * 3
    bands.set(y, (x) => {
      // The tape's position under column x: 0 is its first character.
      const i = head - (width - 1 - x)
      if (i < 0 || !kind.length) return null
      const ticker = kind[(first + Math.floor(i / cycle)) % kind.length]!
      const at = i % cycle
      return { ch: slotText(ticker)[at]!, up: ticker.change >= 0, name: at < ticker.name.length }
    })
  }
  return (x, y) => {
    const at = bands.get(y)?.(x)
    if (!at || at.ch === " ") return { ch: " ", fg: ink.level(0) }
    return { ch: at.ch, fg: at.name ? ink.level(2) : at.up ? ink.up : ink.down }
  }
}
