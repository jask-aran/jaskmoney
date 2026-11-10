import type { TimeframeState } from "../domain/timeframe"
import type { SetStoreFunction } from "solid-js/store"
import type { UiState } from "./uiStore"

const NO_IDS: Record<number, boolean> = Object.freeze({}) as Record<number, boolean>

export function createSelectionActions(state: UiState, setState: SetStoreFunction<UiState>) {
  function clearSelection() {
    setState({ selectedIds: {}, range: null })
  }

  function toggleSelectedId(id: number) {
    const next = { ...state.selectedIds }
    if (next[id]) delete next[id]
    else next[id] = true
    setState({ selectedIds: next })
  }

  function setRangeFromMove(
    anchorId: number,
    cursorId: number,
    selecting: boolean,
  ) {
    setState({ range: selecting ? { anchorId, cursorId } : null })
  }

  function highlightedIds(rows: { id: number }[]): Record<number, boolean> {
    const range = state.range
    if (!range) return NO_IDS
    let a = rows.findIndex((r) => r.id === range.anchorId)
    let b = rows.findIndex((r) => r.id === range.cursorId)
    if (a < 0 || b < 0) return NO_IDS
    if (a > b) [a, b] = [b, a]
    const out: Record<number, boolean> = {}
    for (let i = a; i <= b; i++) {
      const id = rows[i]?.id
      if (id != null) out[id] = true
    }
    return out
  }

  function ensureRange(rows: { id: number }[]) {
    const range = state.range
    if (range && (!rows.some((row) => row.id === range.anchorId) || !rows.some((row) => row.id === range.cursorId))) {
      setState({ range: null })
    }
  }

  function forgetRows() {
    setState({ selectedIds: {}, range: null, pickerTargets: [], detail: null, acceptPreview: null })
  }

  function pruneRows(existing: ReadonlySet<number>) {
    if (!Object.keys(state.selectedIds).some((id) => !existing.has(Number(id)))
      && !state.pickerTargets.some((id) => !existing.has(id))
      && (!state.detail || existing.has(state.detail.id))) return
    setState({
      selectedIds: Object.fromEntries(Object.entries(state.selectedIds).filter(([id]) => existing.has(Number(id)))),
      pickerTargets: state.pickerTargets.filter((id) => existing.has(id)),
      detail: state.detail && !existing.has(state.detail.id) ? null : state.detail,
    })
  }

  function targetIds(rows: { id: number }[]): number[] {
    if (state.detail) return [state.detail.id]
    const hl = Object.keys(highlightedIds(rows)).map(Number)
    if (hl.length) return hl
    const sel = Object.keys(state.selectedIds).map(Number)
    if (sel.length) return sel
    const row = rows[state.managerCursor]
    return row ? [row.id] : []
  }

  return { clearSelection, toggleSelectedId, setRangeFromMove, highlightedIds, ensureRange, forgetRows, pruneRows, targetIds }
}

function cursorWindow(cursor: number, top: number, count: number, visible: number): { cursor: number; top: number } {
  if (count <= 0) return { cursor: 0, top: 0 }
  cursor = Math.max(0, Math.min(count - 1, cursor))
  const vis = Math.max(1, visible)
  if (cursor < top) top = cursor
  if (cursor >= top + vis) top = cursor - vis + 1
  return { cursor, top: Math.max(0, top) }
}

export function createCursorActions(state: UiState, setState: SetStoreFunction<UiState>) {
  function moveManagerCursor(delta: number, rowCount: number) {
    const { cursor, top } = cursorWindow(state.managerCursor + delta, state.managerTop, rowCount, state.managerVisible)
    setState({ managerCursor: cursor, managerTop: top })
  }

  function jumpManagerCursor(index: number, rowCount: number) {
    const { cursor, top } = cursorWindow(index, state.managerTop, rowCount, state.managerVisible)
    setState({ managerCursor: cursor, managerTop: top })
  }

  function setTimeframe(tf: TimeframeState) {
    setState({ timeframe: tf })
  }

  function setDashChipCursor(i: number) {
    setState({ dashChipCursor: i })
  }

  return { moveManagerCursor, jumpManagerCursor, setTimeframe, setDashChipCursor }
}
