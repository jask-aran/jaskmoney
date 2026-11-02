import { For, Index, Show } from "solid-js"
import { Modal } from "../primitives/Modal"
import { TextInput } from "../primitives/TextInput"
import { S } from "../primitives/S"
import { chipLook } from "../primitives/chip"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { ink, tone } from "../../theme"
import { rowAppearance } from "../../domain/rowStyle"
import { appToday } from "../../domain/days"
import { CUSTOM_DATE_FORMS, readCustomRange } from "../../domain/timeframe"
import {
  CALENDAR_VIEWS, CALENDAR_VIEW_LABELS, cellText, markedRange, monthWeeks, pageLabel, unitGrid, unitOf, weekdayNames, type CalendarView,
} from "../../domain/rangeCalendar"
import { onPointer } from "../../app/pointer"
import { markCustomCell, pageCustomCalendar, setCustomView } from "../../app/keys"

type Edit = NonNullable<typeof ui.state.customEdit>

/** Days cells are four columns (" 12 "), months and years seven ("  Jan  "). */
const DAY_CELL = 4
const UNIT_CELL = 7
/** The calendar's lines under its view strip: the days view's weekday
 * names and six weeks; the others pad to it, so the dialog keeps its size. */
const GRID_LINES = 7

/**
 * How a calendar cell looks, from its states (each independent): in the
 * range (scope, the date range's tone), one of its ends (bold, on the
 * selected wash), the cursor (the cursor wash, while the calendar has
 * focus), today (bold).
 */
export function calendarCellLook(state: { inRange: boolean; end: boolean; cursor: boolean; today: boolean }): { fg: string; bg: string | undefined; bold: boolean } {
  if (state.cursor) {
    const look = chipLook({ active: false, cursor: true })
    return { ...look, fg: state.inRange ? tone.scope : look.fg }
  }
  if (state.end) return { fg: tone.scope, bg: rowAppearance(true, false, false).bg ?? undefined, bold: true }
  return { fg: state.inRange ? tone.scope : state.today ? ink.figure : ink.label, bg: undefined, bold: state.today }
}

/**
 * The Custom range dialog: Start and End to type into, and a calendar to
 * mark them on (Days, Months or Years: a cell is a day, a month or a
 * year). Enter (or a click) on a cell marks where the range starts, a
 * second where it ends, and applies it. Keys: app/keys handleOverviewCustom.
 */
export function CustomRangeDialog(props: { edit: Edit }) {
  const here = (s: string) => s === "overview.custom"
  const today = () => appToday()
  // The range shown: the one a waiting mark would make with the cursor,
  // else the fields' as they read.
  const shown = () => {
    const e = props.edit
    if (e.mark) return markedRange(e.mark, e.cursor, e.view)
    const read = readCustomRange(e.start.value, e.end.value, today())
    return "error" in read ? null : read
  }
  const preview = () => {
    const read = readCustomRange(props.edit.start.value, props.edit.end.value, today())
    return "error" in read ? null : read
  }
  const calendarFocused = () => props.edit.field === 2
  const look = (iso: string, view: CalendarView) => {
    const unit = unitOf(iso, view), range = shown()
    const inRange = !!range && unit.start <= range.end && unit.end >= range.start
    const end = !!range && (view === "days" ? iso === range.start || iso === range.end : (range.start >= unit.start && range.start <= unit.end) || (range.end >= unit.start && range.end <= unit.end))
    const cursor = calendarFocused() && unitOf(props.edit.cursor, view).start === unit.start
    const isToday = today() >= unit.start && today() <= unit.end
    return calendarCellLook({ inRange, end, cursor, today: isToday })
  }
  // A cell reads its day as it changes: Index keeps cells by place as the
  // page or view changes under them.
  const cell = (iso: () => string, view: () => CalendarView, width: number) => {
    // Days right-aligned under their weekday names; months and years centred.
    const padded = () => {
      const text = cellText(iso(), view())
      if (view() === "days") return text.padStart(width - 1) + " "
      const left = Math.floor((width - text.length) / 2)
      return " ".repeat(left) + text + " ".repeat(width - left - text.length)
    }
    const l = () => look(iso(), view())
    return (
      <text wrapMode="none" onMouseDown={onPointer(here, () => markCustomCell(ui, iso()))}>
        <S fg={l().fg} bg={l().bg} bold={l().bold}>{padded()}</S>
      </text>
    )
  }
  const field = (index: 0 | 1, name: string) => (
    <box width={23} flexShrink={0} onMouseDown={onPointer(here, () => {
      const e = ui.state.customEdit
      if (e) ui.setState({ customEdit: { ...e, field: index } })
    })}>
      <text wrapMode="none">
        <S fg={props.edit.field === index ? ink.figure : ink.label} bold={props.edit.field === index}>{name}</S>
        <TextInput field={index === 0 ? props.edit.start : props.edit.end} focused={props.edit.field === index} />
      </text>
    </box>
  )
  const hints = () => calendarFocused()
    ? "arrows move · [ ] page · d/m/y view · enter marks"
    : "tab to calendar · ↑↓ a day, ⇧ a week · enter apply"
  return (
    <Modal title="Custom range" width={56} hints={hints()}>
      <box flexDirection="row">
        {field(0, "Start  ")}
        {field(1, "End  ")}
      </box>
      <text> </text>
      {/* The views, and the page the cursor is on between ‹ › (each a click). */}
      <box flexDirection="row" justifyContent="space-between">
        <box flexDirection="row">
          <For each={CALENDAR_VIEWS}>
            {(view) => {
              const l = () => chipLook({ active: props.edit.view === view, cursor: false })
              return (
                <text wrapMode="none" onMouseDown={onPointer(here, () => setCustomView(ui, view))}>
                  <S fg={l().fg} bg={l().bg} bold={l().bold}>{` ${CALENDAR_VIEW_LABELS[view]} `}</S>
                </text>
              )
            }}
          </For>
        </box>
        <box flexDirection="row">
          <text wrapMode="none" onMouseDown={onPointer(here, () => pageCustomCalendar(ui, -1))}><S fg={tone.key} bold>{"‹ "}</S></text>
          <text wrapMode="none" fg={ink.figure}><b>{pageLabel(props.edit.cursor, props.edit.view)}</b></text>
          <text wrapMode="none" onMouseDown={onPointer(here, () => pageCustomCalendar(ui, 1))}><S fg={tone.key} bold>{" ›"}</S></text>
        </box>
      </box>
      <box flexDirection="column" alignItems="center" height={GRID_LINES}>
        <Show when={props.edit.view === "days"} fallback={
          <box flexDirection="column" paddingTop={1}>
            <Index each={unitGrid(props.edit.cursor, props.edit.view as "months" | "years")}>
              {(row, r) => (
                <box flexDirection="row" marginBottom={r < 2 ? 1 : 0}>
                  <Index each={row()}>{(iso) => cell(iso, () => props.edit.view, UNIT_CELL)}</Index>
                </box>
              )}
            </Index>
          </box>
        }>
          <text wrapMode="none" fg={ink.note}>{weekdayNames(data.state.weekStart).map((d) => d.padStart(DAY_CELL - 1) + " ").join("")}</text>
          <Index each={monthWeeks(props.edit.cursor, data.state.weekStart)}>
            {(week) => (
              <box flexDirection="row">
                <Index each={week()}>{(iso) => (
                  <Show when={iso()} fallback={<text wrapMode="none">{" ".repeat(DAY_CELL)}</text>}>
                    {cell(() => iso() ?? "", () => "days", DAY_CELL)}
                  </Show>
                )}</Index>
              </box>
            )}
          </Index>
        </Show>
      </box>
      <text> </text>
      {/* The range as it reads now, as you type or mark; what the fields
          take while one doesn't read; the error enter found. */}
      <Show when={!props.edit.error} fallback={<text fg={tone.bad} wrapMode="none">{props.edit.error}</text>}>
        <Show when={preview()} fallback={<text fg={ink.note} wrapMode="none">{CUSTOM_DATE_FORMS}</text>}>
          {(range: () => { label: string; days: number }) => (
            <text wrapMode="none"><S fg={tone.scope}>{range().label}</S><S fg={ink.note}>{` · ${range().days} days${props.edit.mark ? " · enter where it ends" : ""}`}</S></text>
          )}
        </Show>
      </Show>
    </Modal>
  )
}
