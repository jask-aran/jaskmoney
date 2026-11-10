import type { StyledSpan } from "../primitives/StyledLine"
import type { Ticker } from "../../app/tickers"

/** The welcome page's backdrops (Settings › Appearance). */
export const BACKDROPS = [
  { id: "plasma", label: "plasma" },
  { id: "coins", label: "coin rain" },
  { id: "ticker", label: "ticker tape" },
] as const
export type BackdropId = (typeof BACKDROPS)[number]["id"]
export const DEFAULT_BACKDROP: BackdropId = "ticker"

/** How bright a backdrop's mark is, 0 (barely there) to LEVELS - 1; and the
 * tints for a rise and a fall. The welcome screen picks the colours. */
export const BACKDROP_LEVELS = 6
export interface BackdropInk { level: (level: number) => string; up: string; down: string }

/**
 * The welcome page's backdrop, full screen, behind everything. Pure: the
 * lines for a `width`×`height` screen `t` seconds in. Neighbouring cells of
 * one colour share a span. `tickers`: the tape's real prices, once they've
 * come. `t` is seconds since this backdrop began (a tape streams in from
 * empty).
 *
 * It's drawn 25 times a second, so it's built for that: a backdrop fills a
 * row of characters and colours at a time (no object per cell), `ink.level`
 * should be a lookup (the caller mixes its handful of colours once), and a
 * tape's text is made once per set of prices (tapeOf), not per cell.
 */
export function backdropLines(id: BackdropId, width: number, height: number, t: number, ink: BackdropInk, tickers?: readonly Ticker[]): StyledSpan[][] {
  const row = id === "coins" ? coinRain(width, height, t, ink) : id === "ticker" ? tickerTape(width, height, t, ink, tickers) : plasma(width, height, t, ink)
  const ch: string[] = new Array(Math.max(0, width)), fg: string[] = new Array(Math.max(0, width))
  const lines: StyledSpan[][] = []
  for (let y = 0; y < height; y++) {
    if (width <= 0) { lines.push([]); continue }
    // A row with nothing on it: one blank run.
    if (!row(y, ch, fg)) { lines.push([{ text: " ".repeat(width), fg: ink.level(0) }]); continue }
    const spans: StyledSpan[] = []
    let text = ch[0]!, colour = fg[0]!
    for (let x = 1; x < width; x++) {
      if (fg[x] === colour) text += ch[x]
      else { spans.push({ text, fg: colour }); text = ch[x]!; colour = fg[x]! }
    }
    spans.push({ text, fg: colour })
    lines.push(spans)
  }
  return lines
}

/**
 * `next`, with each line that's the same as `prev`'s line there taken from
 * `prev`; `prev` itself when every line is. The drawing then leaves an
 * unchanged line, or screen, alone: most of a tape's frames change a few
 * of its rows, and many of the coin rain's change none.
 */
export function keepSameLines(prev: readonly StyledSpan[][], next: StyledSpan[][]): StyledSpan[][] {
  let same = prev.length === next.length
  for (let y = 0; y < next.length; y++) {
    const was = prev[y]
    if (was && sameRuns(was, next[y]!)) next[y] = was
    else same = false
  }
  return same ? (prev as StyledSpan[][]) : next
}

function sameRuns(a: readonly StyledSpan[], b: readonly StyledSpan[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i]!.text !== b[i]!.text || a[i]!.fg !== b[i]!.fg) return false
  return true
}

/** Fills row `y`'s characters and colours, `width` of each; false for a
 * blank row (nothing filled). */
type Row = (y: number, ch: string[], fg: string[]) => boolean

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
function plasma(width: number, height: number, t: number, ink: BackdropInk): Row {
  const RAMP = " ··::++==$"
  const cx = width / 2, cy = height / 2
  const levels = Array.from({ length: BACKDROP_LEVELS }, (_, l) => ink.level(l))
  return (y, ch, fg) => {
    // Cells are about twice as tall as wide: y counts double.
    const dy = (y - cy) * 2
    const across = Math.sin(dy * 0.09 - t * 0.6)
    for (let x = 0; x < width; x++) {
      const dx = x - cx
      const v = Math.sin(x * 0.07 + t * 0.9) + across + Math.sin((x + dy) * 0.045 + t * 0.4) + Math.sin(Math.sqrt(dx * dx + dy * dy) * 0.11 - t * 1.1)
      const u = Math.max(0, Math.min(1, ((v + 4) / 8 - 0.45) / 0.55)) ** 1.4
      ch[x] = RAMP[Math.min(RAMP.length - 1, Math.floor(u * RAMP.length))]!
      fg[x] = levels[Math.min(BACKDROP_LEVELS - 1, Math.floor(u * BACKDROP_LEVELS))]!
    }
    return true
  }
}

/**
 * Coin rain: in about one column in three, a "$" falls at its own speed,
 * trailing digits and cents that fade behind it, then starts again from the
 * top after a pause.
 */
function coinRain(width: number, height: number, t: number, ink: BackdropInk): Row {
  const TRAIL = "$0123456789¢.,"
  const levels = Array.from({ length: BACKDROP_LEVELS }, (_, l) => ink.level(l))
  const columns = Array.from({ length: width }, (_, x) => {
    const on = hash(x * 7 + 1) < 0.34
    const speed = 4 + hash(x * 13 + 2) * 9 // rows a second
    const trail = 5 + Math.floor(hash(x * 17 + 3) * 10)
    const cycle = height + trail + 6 + hash(x * 19 + 4) * height
    const head = ((t * speed + hash(x * 23 + 5) * cycle) % cycle) - trail
    return { on, head, trail }
  })
  return (y, ch, fg) => {
    for (let x = 0; x < width; x++) {
      const c = columns[x]!
      const back = c.head - y // 0 at the head, more up the trail
      if (!c.on || back < 0 || back > c.trail) { ch[x] = " "; fg[x] = levels[0]!; continue }
      const fade = 1 - back / c.trail
      // The trail's characters change as it falls: each row a new one.
      ch[x] = back < 1 ? "$" : TRAIL[1 + Math.floor(hash(x * 31 + Math.floor(c.head) * 7 + y) * (TRAIL.length - 1))]!
      fg[x] = levels[back < 1 ? BACKDROP_LEVELS - 1 : Math.max(0, Math.round(fade * (BACKDROP_LEVELS - 2)))]!
    }
    return true
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

/** A ticker as a tape draws it: its slot's text, how much of it is the
 * name, and whether it rose. */
interface Slot { text: string; name: number; up: boolean }
/** A set of prices as tapes, one per kind in the order they come: made
 * once per set (the prices come every couple of minutes), not per frame. */
const tapes = new WeakMap<readonly Ticker[], Slot[][]>()
function tapeOf(list: readonly Ticker[]): Slot[][] {
  let kinds = tapes.get(list)
  if (!kinds) {
    const slots = list.map((k) => ({ group: k.group, slot: { text: slotText(k), name: k.name.length, up: k.change >= 0 } }))
    kinds = [...new Set(slots.map((s) => s.group))].map((group) => slots.filter((s) => s.group === group).map((s) => s.slot))
    tapes.set(list, kinds)
  }
  return kinds
}

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
function tickerTape(width: number, _height: number, t: number, ink: BackdropInk, tickers: readonly Ticker[] = FAKE_TICKERS): Row {
  const kinds = tapeOf(tickers.length ? tickers : FAKE_TICKERS)
  const cycle = SLOT + GAP.length
  const blank = ink.level(0), name = ink.level(2)
  return (y, ch, fg) => {
    if (y % 4 !== 1) return false
    const k = (y - 1) / 4
    const kind = kinds[k % kinds.length]!
    // 2 to 11 columns a second: under half a column a frame at 25.
    const speed = 2 + ((k * 0.618034) % 1) * 9
    // How far the tape has come in from the right edge: after its lead-in
    // (each tape's a little different, so they don't arrive together) it
    // creeps in at its own speed, the speed it keeps.
    const u = t - (LEAD_SECONDS + hash(k * 7 + 3) * 0.8)
    const head = u < 0 ? -1 : Math.floor(u * speed)
    // A kind's second tape starts further along it.
    const first = Math.floor(k / kinds.length) * 3
    for (let x = 0; x < width; x++) {
      // The tape's position under column x: 0 is its first character.
      const i = head - (width - 1 - x)
      const slot = i < 0 ? undefined : kind[(first + Math.floor(i / cycle)) % kind.length]
      const at = i % cycle
      const c = slot ? slot.text[at]! : " "
      ch[x] = c
      fg[x] = c === " " ? blank : at < slot!.name ? name : slot!.up ? ink.up : ink.down
    }
    return true
  }
}
