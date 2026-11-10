import { For, Index, Show } from "solid-js"
import { Modal } from "../primitives/Modal"
import { TextInput } from "../primitives/TextInput"
import { S } from "../primitives/S"
import { chipLook } from "../primitives/chip"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { ink, theme, tone } from "../../theme"
import { rowAppearance } from "../../domain/rowStyle"
import { appToday } from "../../domain/days"
import { CUSTOM_DATE_FORMS, readCustomRange } from "../../domain/timeframe"
import {
  CALENDAR_VIEWS, CALENDAR_VIEW_LABELS, cellText, markedRange, monthWeeks, pageLabel, unitGrid, unitOf, weekdayNames, type CalendarView,
} from "../../domain/rangeCalendar"
import { onPointer } from "../../app/pointer"
import { markCustomCell, pageCustomCalendar, setCustomView } from "../../app/keys"

type Edit = NonNullable<typeof ui.state.customEdit>
type Read = () => Exclude<ReturnType<typeof readCustomRange>, { error: string }> | null

const DAY_CELL = 6
const UNIT_CELL = 12
const GRID_LINES = 11
const DIALOG_WIDTH = 7 * DAY_CELL + 18

function calendarCellLook(state: { inRange: boolean; end: boolean; cursor: boolean; today: boolean }): { fg: string; bg: string | undefined; bold: boolean } {
  if (state.cursor) {
    const look = rowAppearance(state.inRange, false, true)
    return { fg: look.fg ?? ink.figure, bg: look.bg ?? undefined, bold: true }
  }
  if (state.end) return { fg: theme.rowCursorText, bg: tone.scope, bold: true }
  if (state.inRange) return { fg: tone.scope, bg: rowAppearance(true, false, false).bg ?? undefined, bold: state.today }
  return { fg: state.today ? ink.figure : ink.label, bg: undefined, bold: state.today }
}

const here = (s: string) => s === "overview.custom"
const today = () => appToday()

export function CustomRangeDialog(props: { edit: Edit }) {
  const read = () => {
    const r = readCustomRange(props.edit.start.value, props.edit.end.value, today())
    return "error" in r ? null : r
  }
  const hints = () => ({
    page: "←→ page · ↓ calendar · tab next · esc cancel",
    views: "←→ Days, Months, Years · ↓ calendar · tab next",
    grid: props.edit.mark ? "enter where it ends · esc undo · arrows move" : "enter mark · arrows move, off the edge to leave · tab",
    from: "type a date · enter apply · ↑ calendar · tab next",
    to: "type a date · enter apply · ↑ calendar · tab next",
  })[props.edit.focus]
  return (
    <Modal title="Custom range" width={DIALOG_WIDTH} hints={hints()}>
      <text> </text>
      <CustomRangePager edit={props.edit} />
      <text> </text>
      <CustomRangeCalendar edit={props.edit} read={read} />
      <CustomRangeFields edit={props.edit} read={read} />
      <Show when={props.edit.error || !read()}>
        <text wrapMode="none" paddingLeft={1} fg={props.edit.error ? tone.bad : ink.note}>{props.edit.error || CUSTOM_DATE_FORMS}</text>
      </Show>
    </Modal>
  )
}

function CustomRangePager(props: { edit: Edit }) {
  const pageLook = () => chipLook({ active: false, cursor: props.edit.focus === "page" })
  return (
    <box flexDirection="row" justifyContent="space-between" paddingLeft={1} paddingRight={1}>
      <box flexDirection="row">
        <text wrapMode="none" onMouseDown={onPointer(here, () => pageCustomCalendar(ui, -1))}><S fg={tone.key} bold>{"‹ "}</S></text>
        <text wrapMode="none"><S fg={props.edit.focus === "page" ? pageLook().fg : ink.strong} bg={pageLook().bg} bold>{` ${pageLabel(props.edit.cursor, props.edit.view)} `}</S></text>
        <text wrapMode="none" onMouseDown={onPointer(here, () => pageCustomCalendar(ui, 1))}><S fg={tone.key} bold>{" ›"}</S></text>
      </box>
      <box flexDirection="row">
        <For each={CALENDAR_VIEWS}>
          {(view) => {
            const l = () => chipLook({ active: props.edit.view === view, cursor: props.edit.focus === "views" && props.edit.view === view })
            return (
              <text wrapMode="none" onMouseDown={onPointer(here, () => setCustomView(ui, view))}>
                <S fg={l().fg} bg={l().bg} bold={l().bold}>{` ${CALENDAR_VIEW_LABELS[view]} `}</S>
              </text>
            )
          }}
        </For>
      </box>
    </box>
  )
}

function CustomRangeCalendar(props: { edit: Edit; read: Read }) {
  const shown = () => (props.edit.mark ? markedRange(props.edit.mark, props.edit.cursor, props.edit.view) : props.read())
  const calendarFocused = () => props.edit.focus === "grid"
  const look = (iso: string, view: CalendarView) => {
    const unit = unitOf(iso, view), range = shown()
    const inRange = !!range && unit.start <= range.end && unit.end >= range.start
    const holds = (day: string) => day >= unit.start && day <= unit.end
    const end = !!range && (holds(range.start) || holds(range.end))
    const cursor = calendarFocused() && unitOf(props.edit.cursor, view).start === unit.start
    return calendarCellLook({ inRange, end, cursor, today: holds(today()) })
  }
  const cell = (iso: () => string, view: () => CalendarView, width: number) => {
    const padded = () => {
      const text = cellText(iso(), view())
      const left = Math.ceil((width - text.length) / 2)
      return " ".repeat(left) + text + " ".repeat(width - left - text.length)
    }
    const l = () => look(iso(), view())
    return (
      <text wrapMode="none" onMouseDown={onPointer(here, () => markCustomCell(ui, iso()))}>
        <S fg={l().fg} bg={l().bg} bold={l().bold}>{padded()}</S>
      </text>
    )
  }
  const blank = (width: number) => <text wrapMode="none">{" ".repeat(width)}</text>
  return (
    <box flexDirection="column" alignItems="center" height={GRID_LINES + 1}>
      <Show when={props.edit.view === "days"} fallback={
        <box flexDirection="column" paddingTop={1}>
          <Index each={unitGrid(props.edit.cursor, props.edit.view as "months" | "years")}>
            {(row, r) => (
              <box flexDirection="row" marginBottom={r < 2 ? 3 : 0}>
                <Index each={row()}>{(iso) => cell(iso, () => props.edit.view, UNIT_CELL)}</Index>
              </box>
            )}
          </Index>
        </box>
      }>
        <text wrapMode="none" fg={ink.note}>{weekdayNames(data.state.weekStart).map((d) => " ".repeat(Math.ceil((DAY_CELL - 2) / 2)) + d + " ".repeat(Math.floor((DAY_CELL - 2) / 2))).join("")}</text>
        <Index each={monthWeeks(props.edit.cursor, data.state.weekStart)}>
          {(week, w) => (
            <box flexDirection="row" marginTop={w > 0 ? 1 : 0}>
              <Index each={week()}>{(iso) => (
                <Show when={iso()} fallback={blank(DAY_CELL)}>
                  {cell(() => iso() ?? "", () => "days", DAY_CELL)}
                </Show>
              )}</Index>
            </box>
          )}
        </Index>
      </Show>
    </box>
  )
}

function CustomRangeFields(props: { edit: Edit; read: Read }) {
  const field = (focus: "from" | "to", name: string) => (
    <text wrapMode="none" onMouseDown={onPointer(here, () => {
      const e = ui.state.customEdit
      if (e) ui.setState({ customEdit: { ...e, focus } })
    })}>
      <S fg={props.edit.focus === focus ? ink.figure : ink.label} bold={props.edit.focus === focus}>{name}</S>
      <TextInput field={focus === "from" ? props.edit.start : props.edit.end} focused={props.edit.focus === focus} />
    </text>
  )
  return (
    <box flexDirection="row" paddingLeft={1} paddingRight={1} justifyContent="space-between">
      <box flexDirection="row" gap={3}>
        {field("from", "From  ")}
        {field("to", "To  ")}
      </box>
      <text wrapMode="none" fg={ink.note}>{props.read() ? `${props.read()!.days} days` : ""}</text>
    </box>
  )
}
