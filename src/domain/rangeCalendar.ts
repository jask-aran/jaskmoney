import { MONTHS, addDays, addMonthsClamped, dayOfWeek, type WeekStart } from "./days"

/**
 * The Custom range dialog's calendar: a cursor on a day, shown in one of
 * three views. Days: a month's weeks. Months: a year's twelve months.
 * Years: twelve years. A cell stands for a run of days (unitOf): a day, a
 * month or a year, so marking a month's cell takes the whole month. A
 * range is marked in two presses (markedRange): the first cell's start to
 * the second's end, whichever comes first.
 */
export type CalendarView = "days" | "months" | "years"

/** The Custom range dialog's stops, in tab order: the page selector
 * (‹ October 2026 ›), the views (Days Months Years), the grid, From, To. */
export type CustomFocus = "page" | "views" | "grid" | "from" | "to"
export const CUSTOM_FOCUS_ORDER: readonly CustomFocus[] = ["page", "views", "grid", "from", "to"]
export const CALENDAR_VIEWS: readonly CalendarView[] = ["days", "months", "years"]
export const CALENDAR_VIEW_LABELS: Record<CalendarView, string> = { days: "Days", months: "Months", years: "Years" }

/** Months and years views: cells in rows of four. */
export const CALENDAR_COLUMNS = 4

const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`
const monthEnd = (iso: string) => addDays(addMonthsClamped(monthStart(iso), 1), -1)
/** The first year of the twelve the years view shows around `iso`. */
export const yearsFrom = (iso: string) => Math.floor(Number(iso.slice(0, 4)) / 12) * 12

/** The days a cell holding `iso` stands for in `view`. */
export function unitOf(iso: string, view: CalendarView): { start: string; end: string } {
  if (view === "days") return { start: iso, end: iso }
  if (view === "months") return { start: monthStart(iso), end: monthEnd(iso) }
  return { start: `${iso.slice(0, 4)}-01-01`, end: `${iso.slice(0, 4)}-12-31` }
}

/** From a first mark to the cell at `iso`: whichever starts first to
 * whichever ends last (marking backwards works too). */
export function markedRange(mark: { start: string; end: string }, iso: string, view: CalendarView): { start: string; end: string } {
  const at = unitOf(iso, view)
  return { start: at.start < mark.start ? at.start : mark.start, end: at.end > mark.end ? at.end : mark.end }
}

/** A month's weeks for the days view, six rows always (the dialog keeps
 * its height as months change): each a week's seven days, null outside
 * the month. */
export function monthWeeks(iso: string, weekStart: WeekStart): Array<Array<string | null>> {
  const first = monthStart(iso), last = monthEnd(iso)
  let day = addDays(first, -dayOfWeek(first, weekStart))
  return Array.from({ length: 6 }, () => Array.from({ length: 7 }, () => {
    const cell = day >= first && day <= last ? day : null
    day = addDays(day, 1)
    return cell
  }))
}

/** The weekday names over the days view's columns. */
export function weekdayNames(weekStart: WeekStart): string[] {
  const names = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
  return weekStart === "sunday" ? ["Su", ...names.slice(0, 6)] : names
}

/** The months view's twelve, or the years view's twelve, as the day each
 * cell's run starts, in rows of four. */
export function unitGrid(iso: string, view: "months" | "years"): string[][] {
  const cells = view === "months"
    ? MONTHS.map((_, m) => `${iso.slice(0, 4)}-${String(m + 1).padStart(2, "0")}-01`)
    : Array.from({ length: 12 }, (_, k) => `${yearsFrom(iso) + k}-01-01`)
  return Array.from({ length: cells.length / CALENDAR_COLUMNS }, (_, r) => cells.slice(r * CALENDAR_COLUMNS, (r + 1) * CALENDAR_COLUMNS))
}

/** A cell's text: the day, the month's name, the year. */
export function cellText(iso: string, view: CalendarView): string {
  return view === "days" ? String(Number(iso.slice(8, 10))) : view === "months" ? MONTHS[Number(iso.slice(5, 7)) - 1]! : iso.slice(0, 4)
}

/** Where the selector between ‹ › says the view is: "November 2026",
 * "2026", "2016 – 2027". */
export function pageLabel(iso: string, view: CalendarView): string {
  if (view === "days") return `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
  if (view === "months") return iso.slice(0, 4)
  return `${yearsFrom(iso)} – ${yearsFrom(iso) + 11}`
}

/** The cursor moved by an arrow: a day or a week in days; a month, or a
 * row of four, in months; a year, or four, in years. */
export function moveCursor(iso: string, view: CalendarView, dir: "left" | "right" | "up" | "down"): string {
  const sign = dir === "left" || dir === "up" ? -1 : 1
  const row = dir === "up" || dir === "down"
  if (view === "days") return addDays(iso, sign * (row ? 7 : 1))
  return addMonthsClamped(iso, sign * (row ? CALENDAR_COLUMNS : 1) * (view === "years" ? 12 : 1))
}

/** The cursor a page on ([ ], or ‹ ›): a month, a year, or twelve years. */
export function pageCursor(iso: string, view: CalendarView, delta: -1 | 1): string {
  return addMonthsClamped(iso, delta * (view === "days" ? 1 : view === "months" ? 12 : 144))
}

/** A row up or down in the grid (a week, or a row of four months or
 * years), or null where that leaves the page shown: the arrow leaves the
 * grid there instead (to the controls above or the dates below). */
export function rowStep(iso: string, view: CalendarView, dir: "up" | "down"): string | null {
  const next = moveCursor(iso, view, dir)
  const page = (d: string) => (view === "days" ? d.slice(0, 7) : view === "months" ? d.slice(0, 4) : String(yearsFrom(d)))
  return page(next) === page(iso) ? next : null
}

/** Whether the cursor's cell is in the grid's left half (the arrow out of
 * it lands on the control on that side: the page selector or From). */
export function leftHalf(iso: string, view: CalendarView, weekStart: WeekStart): boolean {
  if (view === "days") return dayOfWeek(iso, weekStart) < 4
  const index = view === "months" ? Number(iso.slice(5, 7)) - 1 : Number(iso.slice(0, 4)) - yearsFrom(iso)
  return index % CALENDAR_COLUMNS < CALENDAR_COLUMNS / 2
}
