export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
export const MONTH_NAMES = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]

const DAY_MS = 86400000
let clock: Date | null = null

export function appNow(): Date {
  return clock === null ? new Date() : new Date(clock)
}

export function appToday(): string {
  return toISODay(appNow())
}

export function setAppClock(date: Date | null): void {
  clock = date === null ? null : new Date(date)
}

export function toISODay(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number)
  return new Date(y!, (m ?? 1) - 1, d ?? 1)
}

export function dayTime(iso: string): number {
  return Date.parse(iso + "T12:00:00Z")
}

export function parseDay(iso: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null
  const time = dayTime(iso)
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso ? iso : null
}

export function addDays(iso: string, days: number): string {
  return new Date(dayTime(iso) + days * DAY_MS).toISOString().slice(0, 10)
}

export function daysBetween(a: string, b: string): number {
  return (dayTime(b) - dayTime(a)) / DAY_MS
}

export function weekdayIndex(iso: string): number {
  return new Date(dayTime(iso)).getUTCDay()
}

export type WeekStart = "monday" | "sunday"

export function dayOfWeek(iso: string, weekStart: WeekStart): number {
  return (weekdayIndex(iso) + (weekStart === "sunday" ? 0 : 6)) % 7
}

export function addMonths(iso: string, months: number): string {
  const date = new Date(dayTime(iso))
  date.setUTCMonth(date.getUTCMonth() + months)
  return date.toISOString().slice(0, 10)
}

export function addMonthsClamped(iso: string, months: number): string {
  const first = addMonths(iso.slice(0, 8) + "01", months)
  const last = addDays(addMonths(first, 1), -1)
  return first.slice(0, 8) + String(Math.min(Number(iso.slice(8, 10)), Number(last.slice(8, 10)))).padStart(2, "0")
}

export function syncAgo(iso: string | null, now: number): string | null {
  if (!iso) return null
  const minutes = Math.floor((now - Date.parse(iso)) / 60000)
  if (!Number.isFinite(minutes)) return null
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 48 * 60) return `${Math.floor(minutes / 60)}h ago`
  return `${Math.floor(minutes / 1440)}d ago`
}
