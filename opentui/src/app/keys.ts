import type { KeyEvent } from "@opentui/core"
import { JUMP_TARGETS, TABS, type ScopeId, type UiStore } from "../state/uiStore"
import type { DataStore } from "../state/dataStore"
import {
  LOOKBACKS,
  PERIOD_LABEL,
  activeChipIndex,
  applyChip,
  chipCount,
  dataClock,
  stepPeriod,
  timeframeBounds,
} from "../domain/timeframe"

function isPrintable(key: KeyEvent): boolean {
  if (key.ctrl || key.meta) return false
  const s = key.sequence
  if (!s || s.length !== 1) return false
  const code = s.charCodeAt(0)
  return code >= 32 && code !== 127
}

function moveTxnCursor(
  ui: UiStore,
  data: DataStore | undefined,
  delta: number,
  withRange: boolean,
) {
  const rows = data?.scopedTransactions() ?? []
  if (rows.length === 0) return
  const prev = rows[ui.state.managerCursor]
  ui.moveManagerCursor(delta, rows.length)
  const cur = rows[ui.state.managerCursor]
  if (!cur) return
  if (withRange) {
    const anchorId =
      ui.state.rangeSelecting && ui.state.rangeAnchorId
        ? ui.state.rangeAnchorId
        : (prev?.id ?? cur.id)
    ui.setRangeFromMove(anchorId, cur.id, true)
  } else if (ui.state.rangeSelecting) {
    ui.setRangeFromMove(0, 0, false)
  }
}

export function handleKey(ui: UiStore, key: KeyEvent, data?: DataStore): boolean {
  const name = key.name
  const seq = key.sequence

  if (key.ctrl && name === "c") return false

  // ── Jump ────────────────────────────────────────────────────────────
  if (ui.state.jumpMode) {
    if (name === "escape" || name === "v") {
      ui.cancelJump()
      return true
    }
    const hit = JUMP_TARGETS[ui.state.activeTab].find(
      (t) => t.key === name || t.key === seq,
    )
    if (hit) {
      ui.applyJump(hit.section)
      return true
    }
    return true
  }


  // ── Tag picker ──────────────────────────────────────────────────────
  if (ui.state.tagPickerOpen) {
    const q = ui.state.tagPickerQuery.trim().toLowerCase()
    const tags = (data?.state.tags ?? []).filter(
      (tg) => !q || tg.name.toLowerCase().includes(q),
    )
    if (name === "escape") {
      ui.closeTagPicker()
      ui.setStatus("Tags cancelled")
      return true
    }
    if (name === "j" || name === "down") {
      if (tags.length)
        ui.setState({
          tagPickerCursor: Math.min(tags.length - 1, ui.state.tagPickerCursor + 1),
        })
      return true
    }
    if (name === "k" || name === "up") {
      ui.setState({ tagPickerCursor: Math.max(0, ui.state.tagPickerCursor - 1) })
      return true
    }
    if (name === "space" || seq === " ") {
      const tag = tags[ui.state.tagPickerCursor]
      const trows = data?.scopedTransactions() ?? []
      const targets = selectedOrCursorIds(ui, trows)
      if (tag && data && targets.length) {
        ui.setStatus(data.toggleTagOnTransactions(targets, tag.id))
      }
      return true
    }
    if (name === "return" || name === "enter") {
      ui.closeTagPicker()
      ui.setStatus("Tags applied")
      return true
    }
    if (name === "backspace") {
      ui.setState({
        tagPickerQuery: ui.state.tagPickerQuery.slice(0, -1),
        tagPickerCursor: 0,
      })
      return true
    }
    if (isPrintable(key)) {
      ui.setState({
        tagPickerQuery: ui.state.tagPickerQuery + seq,
        tagPickerCursor: 0,
      })
      return true
    }
    return true
  }

  // ── Cat picker ──────────────────────────────────────────────────────
  if (ui.state.catPickerOpen) {
    const q = ui.state.catPickerQuery.trim().toLowerCase()
    const cats = (data?.state.categories ?? []).filter(
      (c) => !q || c.name.toLowerCase().includes(q),
    )
    if (name === "escape") {
      ui.closeCatPicker()
      ui.setStatus("Categorize cancelled")
      return true
    }
    if (name === "j" || name === "down") {
      const n = cats.length
      if (n > 0) {
        ui.setState({
          catPickerCursor: Math.min(n - 1, ui.state.catPickerCursor + 1),
        })
      }
      return true
    }
    if (name === "k" || name === "up") {
      ui.setState({
        catPickerCursor: Math.max(0, ui.state.catPickerCursor - 1),
      })
      return true
    }
    if (name === "return" || name === "enter") {
      const cat = cats[ui.state.catPickerCursor]
      const rows = data?.scopedTransactions() ?? []
      const row = rows[ui.state.managerCursor]
      // Prefer selection targets
      const targets = selectedOrCursorIds(ui, rows)
      if (cat && data && targets.length) {
        let last = ""
        for (const id of targets) {
          last = data.categorizeTransaction(id, cat.id)
        }
        ui.closeCatPicker()
        ui.setStatus(
          targets.length > 1
            ? `Categorized ${targets.length} → ${cat.name}`
            : last,
        )
      } else {
        ui.closeCatPicker()
        ui.setStatus("Nothing to categorize", true)
      }
      return true
    }
    if (name === "backspace") {
      ui.setState({
        catPickerQuery: ui.state.catPickerQuery.slice(0, -1),
        catPickerCursor: 0,
      })
      return true
    }
    if (isPrintable(key)) {
      ui.setState({
        catPickerQuery: ui.state.catPickerQuery + seq,
        catPickerCursor: 0,
      })
      return true
    }
    return true
  }

  // ── Filter input (live parse every keystroke) ───────────────────────
  if (ui.state.filterMode) {
    if (name === "escape") {
      ui.closeFilter(false)
      data?.clearFilter()
      ui.jumpManagerCursor(0, data?.scopedTransactions().length ?? 0)
      ui.setStatus("Filter cleared")
      return true
    }
    if (name === "return" || name === "enter") {
      const draft = ui.state.filterDraft
      ui.closeFilter(true)
      const r = data?.commitFilter(draft) ?? { ok: true, err: "" }
      ui.jumpManagerCursor(0, data?.scopedTransactions().length ?? 0)
      if (!draft.trim()) {
        ui.setStatus("Filter cleared")
      } else if (r.ok) {
        ui.setStatus(`Filter ok · ${data?.scopedTransactions().length ?? 0} rows`)
      } else {
        ui.setStatus(`Filter live (not strict): ${r.err}`, true)
      }
      return true
    }
    if (name === "backspace") {
      const next = ui.state.filterDraft.slice(0, -1)
      ui.setState({ filterDraft: next })
      data?.setFilterLive(next)
      ui.jumpManagerCursor(0, data?.scopedTransactions().length ?? 0)
      return true
    }
    if (isPrintable(key)) {
      const next = ui.state.filterDraft + seq
      ui.setState({ filterDraft: next })
      data?.setFilterLive(next)
      ui.jumpManagerCursor(0, data?.scopedTransactions().length ?? 0)
      return true
    }
    return true
  }

  // ── Global ──────────────────────────────────────────────────────────
  if (name === "v") {
    ui.enterJump()
    return true
  }

  for (const t of TABS) {
    if (name === t.hotkey || seq === t.hotkey) {
      ui.switchTab(t.id)
      return true
    }
  }

  if (name === "tab") {
    ui.cycleTab(key.shift ? -1 : 1)
    return true
  }

  const scope: ScopeId = ui.activeScope()
  const rows = data?.scopedTransactions() ?? []
  const accounts = data?.state.accounts ?? []
  const clock = dataClock(data?.state.transactions ?? [])

  // ── Manager txns ────────────────────────────────────────────────────
  if (scope === "manager.txns") {
    if (name === "/" || seq === "/") {
      ui.openFilter(data?.state.filterQuery ?? "")
      return true
    }
    if (name === "u") {
      const nSel = Object.keys(ui.state.selectedIds).length
      if (nSel > 0 || ui.state.rangeSelecting) {
        ui.clearSelection()
        ui.setStatus("Selection cleared")
      } else if (data?.state.filterQuery) {
        data.clearFilter()
        ui.jumpManagerCursor(0, data.scopedTransactions().length)
        ui.setStatus("Filter cleared")
      }
      return true
    }
    if (name === "s" && !key.shift) {
      const col = data?.cycleSortColumn() ?? "date"
      ui.jumpManagerCursor(0, rows.length)
      ui.setStatus(`Sort: ${col} ${data?.state.sortAscending ? "↑" : "↓"}`)
      return true
    }
    if ((name === "s" && key.shift) || name === "S") {
      const asc = data?.toggleSortDirection() ?? false
      ui.setStatus(`Sort: ${data?.state.sortColumn ?? "date"} ${asc ? "↑" : "↓"}`)
      return true
    }
    if (name === "c") {
      if (rows.length === 0) {
        ui.setStatus("No row to categorize", true)
        return true
      }
      ui.openCatPicker()
      return true
    }
    if (name === "t") {
      if (rows.length === 0) {
        ui.setStatus("No row to tag", true)
        return true
      }
      ui.openTagPicker()
      return true
    }
    // Go's transaction scope deliberately leaves Esc unbound. Selections,
    // range state, and an applied filter therefore remain untouched.
    if (name === "escape") return true
    if (name === "space" || seq === " ") {
      const hl = ui.highlightedIds(rows)
      const hlIds = Object.keys(hl).map(Number)
      if (ui.state.rangeSelecting && hlIds.length > 0) {
        const allOn = hlIds.every((id) => ui.state.selectedIds[id])
        const next = { ...ui.state.selectedIds }
        for (const id of hlIds) {
          if (allOn) delete next[id]
          else next[id] = true
        }
        ui.setState({ selectedIds: next, rangeSelecting: false })
        ui.setStatus(allOn ? `Deselected ${hlIds.length}` : `Selected ${hlIds.length}`)
      } else {
        const row = rows[ui.state.managerCursor]
        if (row) {
          ui.toggleSelectedId(row.id)
          const on = !!ui.state.selectedIds[row.id]
          ui.setStatus(on ? `Selected #${row.id}` : `Deselected #${row.id}`)
        }
      }
      return true
    }
    if (name === "j" || name === "down") {
      moveTxnCursor(ui, data, 1, key.shift)
      return true
    }
    if (name === "k" || name === "up") {
      moveTxnCursor(ui, data, -1, key.shift)
      return true
    }
    if (name === "g" && !key.shift) {
      ui.jumpManagerCursor(0, rows.length)
      ui.setRangeFromMove(0, 0, false)
      ui.setStatus("Top")
      return true
    }
    if ((name === "g" && key.shift) || name === "G") {
      ui.jumpManagerCursor(rows.length - 1, rows.length)
      ui.setRangeFromMove(0, 0, false)
      ui.setStatus("Bottom")
      return true
    }
    if (name === "pageup") {
      moveTxnCursor(ui, data, -ui.state.managerVisible, key.shift)
      return true
    }
    if (name === "pagedown") {
      moveTxnCursor(ui, data, ui.state.managerVisible, key.shift)
      return true
    }
  }

  // ── Manager accounts ────────────────────────────────────────────────
  if (scope === "manager.accounts") {
    if (name === "j" || name === "down" || name === "l" || name === "right") {
      ui.moveAccountCursor(1, accounts.length)
      return true
    }
    if (name === "k" || name === "up" || name === "h" || name === "left") {
      ui.moveAccountCursor(-1, accounts.length)
      return true
    }
    if (name === "space" || seq === " ") {
      const a = accounts[ui.state.accountCursor]
      if (a && data) {
        data.toggleAccount(a.id)
        const on = data.state.accountScope[a.id] !== false
        ui.setStatus(`${a.name} ${on ? "On" : "Off"}`)
      }
      return true
    }
  }

  // ── Dashboard date ──────────────────────────────────────────────────
  if (scope === "dashboard.date") {
    if (name === "h" || name === "left") {
      const n = chipCount()
      ui.setDashChipCursor((ui.state.dashChipCursor - 1 + n) % n)
      return true
    }
    if (name === "l" || name === "right") {
      const n = chipCount()
      ui.setDashChipCursor((ui.state.dashChipCursor + 1) % n)
      return true
    }
    if (name === "return" || name === "enter") {
      const tf = applyChip(ui.state.timeframe, ui.state.dashChipCursor, clock)
      ui.setTimeframe(tf)
      const b = timeframeBounds(tf, clock)
      const label =
        tf.family === "lookback" ? tf.lookback : PERIOD_LABEL[tf.period]
      ui.setStatus(
        `Dashboard ${tf.family === "lookback" ? "timeframe" : "period"}: ${label} · ${b.label}`,
      )
      return true
    }
    if (name === "[" || seq === "[") {
      if (ui.state.timeframe.family === "period") {
        const tf = stepPeriod(ui.state.timeframe, -1)
        ui.setTimeframe(tf)
        ui.setStatus(`Period ← ${timeframeBounds(tf, clock).label}`)
      }
      return true
    }
    if (name === "]" || seq === "]") {
      if (ui.state.timeframe.family === "period") {
        const tf = stepPeriod(ui.state.timeframe, 1)
        ui.setTimeframe(tf)
        ui.setStatus(`Period → ${timeframeBounds(tf, clock).label}`)
      }
      return true
    }
  }

  if (scope === "dashboard") {
    if (name === "[" || seq === "[") {
      if (ui.state.timeframe.family === "period") {
        ui.setTimeframe(stepPeriod(ui.state.timeframe, -1))
      }
      return true
    }
    if (name === "]" || seq === "]") {
      if (ui.state.timeframe.family === "period") {
        ui.setTimeframe(stepPeriod(ui.state.timeframe, 1))
      }
      return true
    }
    if (name === "0") {
      const tf = applyChip(
        { ...ui.state.timeframe, family: "period", period: "month" },
        LOOKBACKS.length,
        clock,
      )
      ui.setTimeframe(tf)
      ui.setDashChipCursor(activeChipIndex(tf))
      ui.setStatus(`This month · ${timeframeBounds(tf, clock).label}`)
      return true
    }
  }

  if (name === "escape" && ui.state.focusedSection !== "none") {
    ui.clearFocus()
    return true
  }

  return false
}

function selectedOrCursorIds(
  ui: UiStore,
  rows: { id: number }[],
): number[] {
  const hl = ui.highlightedIds(rows)
  const hlIds = Object.keys(hl).map(Number)
  if (hlIds.length) return hlIds
  const sel = Object.keys(ui.state.selectedIds).map(Number)
  if (sel.length) return sel
  const row = rows[ui.state.managerCursor]
  return row ? [row.id] : []
}

export function footerHints(scope: ScopeId): { key: string; desc: string }[] {
  switch (scope) {
    case "jump":
      return [
        { key: "letter", desc: "jump" },
        { key: "esc", desc: "cancel" },
      ]
    case "filter":
      return [
        { key: "enter", desc: "apply" },
        { key: "esc", desc: "clear" },
        { key: "type", desc: "expr" },
      ]
    case "catPicker":
      return [
        { key: "j/k", desc: "move" },
        { key: "enter", desc: "apply" },
        { key: "esc", desc: "cancel" },
        { key: "type", desc: "filter" },
      ]
    case "tagPicker":
      return [
        { key: "j/k", desc: "move" },
        { key: "space", desc: "toggle" },
        { key: "enter", desc: "done" },
        { key: "esc", desc: "cancel" },
      ]
    case "dashboard":
      return [
        { key: "v", desc: "jump" },
        { key: "[/]", desc: "period" },
        { key: "0", desc: "this month" },
        { key: "1-3", desc: "tab" },
      ]
    case "dashboard.date":
      return [
        { key: "h/l", desc: "chip" },
        { key: "enter", desc: "apply" },
        { key: "[/]", desc: "shift period" },
        { key: "esc", desc: "done" },
      ]
    case "manager.txns":
      return [
        { key: "j/k", desc: "move" },
        { key: "S-j/k", desc: "range" },
        { key: "space", desc: "select" },
        { key: "c", desc: "cat" },
        { key: "t", desc: "tag" },
        { key: "s", desc: "sort" },
        { key: "S-s", desc: "reverse" },
        { key: "/", desc: "filter" },
        { key: "v", desc: "jump" },
      ]
    case "manager.accounts":
      return [
        { key: "h/l", desc: "move" },
        { key: "space", desc: "toggle" },
        { key: "v", desc: "jump" },
      ]
    case "settings":
      return [
        { key: "v", desc: "jump" },
        { key: "1-3", desc: "tab" },
      ]
    default:
      return [{ key: "v", desc: "jump" }]
  }
}
