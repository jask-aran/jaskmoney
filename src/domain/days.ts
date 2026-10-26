/** Short calendar month names for display. */
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

const DAY_MS = 86400000
let clock: Date | null = null

/** Current app time; return a copy so callers cannot change the test clock. */
export function appNow(): Date {
  return clock === null ? new Date() : new Date(clock)
}

/** Current local calendar day. */
export function appToday(): string {
  return toISODay(appNow())
}

/** Override the app clock for tests; null restores the real clock. */
export function setAppClock(date: Date | null): void {
  clock = date === null ? null : new Date(date)
}

/** Local calendar day of a Date. */
export function toISODay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** Parse a calendar date as local midnight, preserving the legacy Date API. */
export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

/** A UTC-noon representation for calendar arithmetic, independent of DST. */
export function dayTime(iso: string): number {
  return Date.parse(iso + "T12:00:00Z")
}

/** A real YYYY-MM-DD calendar date, or null. */
export function parseDay(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const time = dayTime(iso)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso ? iso : null
}

/** Shift a calendar day by a whole number of days. */
export function addDays(iso: string, days: number): string {
  return new Date(dayTime(iso) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Signed calendar-day distance from a to b. */
export function daysBetween(a: string, b: string): number {
  return (dayTime(b) - dayTime(a)) / DAY_MS
}

/** Weekday of a calendar day, with Sunday = 0. */
export function weekdayIndex(iso: string): number {
  return new Date(dayTime(iso)).getUTCDay()
}

/** Shift calendar months with Date's overflow rule, used by lookbacks. */
export function addMonths(iso: string, months: number): string {
  const date = new Date(dayTime(iso))
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 10)
}

/** Shift calendar months, clamping the day to the destination month's end. */
export function addMonthsClamped(iso: string, months: number): string {
  const first = addMonths(iso.slice(0, 8) + "01", months)
  const last = addDays(addMonths(first, 1), -1)
  return first.slice(0, 8) + String(Math.min(Number(iso.slice(8, 10)), Number(last.slice(8, 10)))).padStart(2, "0")
}
