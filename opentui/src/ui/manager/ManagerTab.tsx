import { For, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { ui, type SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme, uncategorisedColor } from "../../theme"
import { formatMoney } from "../../domain/dashboard"
import { rowBackground } from "../../domain/rowStyle"
import { filterExprString } from "../../domain/filter"

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y.slice(2)}`
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return s.slice(0, Math.max(0, n - 1)) + "…"
}

function catFg(color: string | undefined): string {
  if (!color || color === "" || color === "#7f849c") return uncategorisedColor
  return color
}

function formatTags(
  names: string[],
  colors: string[],
  width: number,
): { text: string; color: string } {
  if (!names.length) return { text: "-".padEnd(width), color: theme.overlay1 }
  const head = names[0]!
  const extra = names.length > 1 ? `+${names.length - 1}` : ""
  const raw = extra ? `${head},${extra}` : head
  return {
    text: truncate(raw, width).padEnd(width),
    color: colors[0] || theme.teal,
  }
}

export function ManagerTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  const rows = createMemo(() => data.scopedTransactions())
  const accounts = () => data.state.accounts
  const highlighted = createMemo(() => ui.highlightedIds(rows()))

  createEffect(() => {
    const h = dims().height
    const vis = Math.max(8, h - 16)
    if (vis !== ui.state.managerVisible) {
      ui.setState({ managerVisible: vis })
    }
  })

  createEffect(() => {
    const n = rows().length
    if (n === 0 && ui.state.managerCursor !== 0) {
      ui.setState({ managerCursor: 0, managerTop: 0 })
    } else if (n > 0 && ui.state.managerCursor >= n) {
      ui.jumpManagerCursor(n - 1, n)
    }
  })

  const windowRows = createMemo(() => {
    const all = rows()
    return all.slice(ui.state.managerTop, ui.state.managerTop + ui.state.managerVisible)
  })

  const txFocused = () =>
    props.focused === "mgr.transactions" || props.focused === "none"
  const acctFocused = () => props.focused === "mgr.accounts"
  const selCount = () => Object.keys(ui.state.selectedIds).length

  const sortMark = (col: string) => {
    if (data.state.sortColumn !== col) return ""
    return data.state.sortAscending ? " ▲" : " ▼"
  }

  // Go-style filter bar: / input  ● ok|parse  [canonical]
  const filterBar = () => {
    const editing = ui.state.filterMode
    const raw = editing ? ui.state.filterDraft : data.state.filterQuery
    if (!editing && !raw.trim()) return null
    const err = data.state.filterErr
    const dotColor = err ? theme.error : theme.success
    const dotLabel = err ? "parse" : "ok"
    const preview =
      data.filterPreview() ||
      (data.state.filterExpr ? filterExprString(data.state.filterExpr) : raw)
    return { editing, raw, err, dotColor, dotLabel, preview }
  }

  return (
    <box width="100%" height="100%" flexDirection="column" gap={0} backgroundColor={theme.base}>
      <SectionCard title="Accounts" focused={acctFocused()} active={acctFocused()} height={3}>
        {accounts().length === 0 ? (
          <text fg={theme.overlay1}>No accounts · waiting for ingest</text>
        ) : (
          <box flexDirection="row" gap={3}>
            <For each={accounts()}>
              {(a, i) => {
                const on = () => data.state.accountScope[a.id] !== false
                const count = () =>
                  data.state.transactions.filter((t) => t.accountId === a.id).length
                const selected = () => acctFocused() && ui.state.accountCursor === i()
                const typeColor = () =>
                  a.type === "credit" ? theme.peach : theme.subtext1
                const countColor = () =>
                  count() === 0 ? theme.overlay1 : theme.subtext1
                const scopeColor = () => (on() ? theme.success : theme.overlay1)
                const scopeText = () => (on() ? "On" : "Off")
                const countText = () => (count() === 0 ? "Empty" : String(count()))
                return (
                  <text>
                    <S fg={theme.accent} bold>
                      {selected() ? "▸ " : "  "}
                    </S>
                    <S fg={theme.text}>{a.name}</S>
                    <S fg={theme.text}> </S>
                    <S fg={typeColor()}>{a.type.toUpperCase()}</S>
                    <S fg={theme.text}> </S>
                    <S fg={countColor()}>{countText()}</S>
                    <S fg={theme.text}> </S>
                    <S fg={scopeColor()}>{scopeText()}</S>
                  </text>
                )
              }}
            </For>
          </box>
        )}
      </SectionCard>

      <Show when={filterBar()}>
        {(fb: () => NonNullable<ReturnType<typeof filterBar>>) => (
          <box width="100%" height={1} paddingLeft={1} backgroundColor={theme.base}>
            <text>
              <S fg={theme.accent} bold>
                /
              </S>
              <S fg={theme.text}> {fb().raw}</S>
              {fb().editing ? <S fg={theme.accent}>▌</S> : null}
              <S fg={theme.text}>  </S>
              <S fg={fb().dotColor}>●</S>
              <S fg={fb().dotColor}> {fb().dotLabel}</S>
              {fb().preview ? (
                <S fg={theme.blue}>  → [{truncate(fb().preview, 40)}]</S>
              ) : null}
              {!fb().editing ? (
                <S fg={theme.overlay1}>  (esc clear)</S>
              ) : fb().err ? (
                <S fg={theme.error}>  {truncate(fb().err, 36)}</S>
              ) : null}
            </text>
          </box>
        )}
      </Show>

      <SectionCard
        title={
          selCount() > 0
            ? `Transactions (${rows().length}/${data.state.transactions.length}) · ${selCount()} selected`
            : `Transactions (${rows().length}/${data.state.transactions.length})`
        }
        focused={txFocused()}
        active={txFocused()}
        flexGrow={1}
        height="100%"
      >
        <text fg={theme.subtext0}>
          <b>
            {"  "}
            {`Date${sortMark("date")}`.padEnd(9)}
            {`Amount${sortMark("amount")}`.padStart(11)}
            {"  "}
            {`Description${sortMark("description")}`.padEnd(32)}
            {`Account${sortMark("account")}`.padEnd(12)}
            {`Category${sortMark("category")}`.padEnd(14)}
            {"Tags"}
          </b>
        </text>
        {rows().length === 0 ? (
          <text fg={theme.overlay1}>
            {data.state.filterQuery ? "No matches" : "Empty · no transactions loaded"}
          </text>
        ) : (
          <box flexGrow={1} flexDirection="column">
            <For each={windowRows()}>
              {(r, i) => {
                const absIndex = () => ui.state.managerTop + i()
                const isCursor = () =>
                  txFocused() &&
                  !ui.state.filterMode &&
                  absIndex() === ui.state.managerCursor
                const selected = () => !!ui.state.selectedIds[r.id]
                const hl = () => !!highlighted()[r.id]
                // OpenTUI cannot repaint a previous cell to transparency: it must
                // receive the table's base colour when a row loses its state bg.
                // This is visually identical to the unstyled table background.
                const rowBg = () =>
                  rowBackground(selected(), hl(), isCursor()) ?? theme.base
                const tags = () => formatTags(r.tagNames, r.tagColors, 12)
                const strong = () => isCursor()
                return (
                  <text bg={rowBg()}>
                    <S fg={theme.accent} bg={rowBg()} bold={strong()}>
                      {isCursor() ? ">" : selected() ? "*" : " "}
                    </S>
                    <S fg={theme.text} bg={rowBg()} bold={strong()}>
                      {fmtDate(r.dateISO).padEnd(8)}
                    </S>
                    <S
                      fg={r.amount < 0 ? theme.error : theme.success}
                      bg={rowBg()}
                      bold={strong()}
                    >
                      {formatMoney(r.amount).padStart(11)}
                    </S>
                    <S fg={theme.text} bg={rowBg()} bold={strong()}>
                      {"  "}
                      {truncate(r.description, 30).padEnd(32)}
                    </S>
                    <S fg={theme.subtext1} bg={rowBg()} bold={strong()}>
                      {truncate(r.accountName, 11).padEnd(12)}
                    </S>
                    <S fg={catFg(r.categoryColor)} bg={rowBg()} bold={strong()}>
                      {truncate(r.categoryName, 13).padEnd(14)}
                    </S>
                    <S fg={tags().color} bg={rowBg()} bold={strong()}>
                      {tags().text}
                    </S>
                  </text>
                )
              }}
            </For>
            <text fg={theme.overlay1}>
              {"  "}— showing {ui.state.managerTop + 1}-
              {Math.min(ui.state.managerTop + ui.state.managerVisible, rows().length)} of{" "}
              {rows().length}
              {selCount() > 0 ? ` · ${selCount()} selected` : ""}
              {ui.state.rangeSelecting ? " · range" : ""}
              {` · sort ${data.state.sortColumn}${data.state.sortAscending ? "↑" : "↓"}`} —
            </text>
          </box>
        )}
      </SectionCard>
    </box>
  )
}
