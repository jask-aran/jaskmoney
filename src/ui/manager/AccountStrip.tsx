import { For, Show, createMemo } from "solid-js"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import type { Span } from "../primitives/spans"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { formatMoney } from "../../domain/dashboard"
import { accountStrip, selectedAccounts, type AccountTile } from "../../domain/accountTree"
import { computeAccountStats } from "../../domain/accountStats"
import { appToday } from "../../domain/days"
import { fit } from "../text"

/** Rows the strip takes, borders included. */
export const STRIP_HEIGHT = 4
/** Cells between tiles: three spaces in a group, " │ " between groups. */
const GAP = 3
/** Cells for the "‹ " and " ›" marks when tiles are cut off. */
const MORE = 2

/** The Transactions tab's accounts: a tile per account (name over
 * balance) in one row above the table. The selected tile is marked; its
 * pending total and 30-day flows sit in the bottom border. */
export function AccountStrip(props: { focused: boolean; width: number }) {
  const tiles = createMemo(() => accountStrip(data.state.accounts).flatMap((group, g) =>
    group.map((tile, i) => ({ tile, groupStart: g > 0 && i === 0, width: 2 + tileWidth(tile) }))))
  const selected = () => tiles().findIndex((t) => t.tile.selection === data.state.accountSelection)
  // Inner width: borders and padding take four cells.
  const window = createMemo(() => stripWindow(tiles().map((t) => t.width), Math.max(0, selected()), props.width - 4))
  const shown = () => tiles().slice(window().start, window().end)

  const stats = createMemo(() => computeAccountStats(selectedAccounts(data.state.accounts, data.state.accountSelection), data.state.transactions, appToday()))
  const bottom = (): Span[] => {
    const s = stats()
    const flows = s.windows[0]
    return [
      ...(s.held.count > 0 ? [{ text: `${formatMoney(Math.abs(s.held.amount))} pending, ${s.held.count} txn · `, fg: theme.overlay1 }] : []),
      ...(flows ? [
        { text: "30 days in ", fg: theme.overlay1 },
        { text: formatMoney(flows.moneyIn), fg: theme.success },
        { text: " out ", fg: theme.overlay1 },
        { text: formatMoney(flows.moneyOut), fg: theme.error },
      ] : []),
    ]
  }

  const line = (part: (tile: AccountTile, current: boolean) => { text: string; fg: string; bold?: boolean }) => (
    <text wrapMode="none">
      <S fg={theme.overlay1}>{window().start > 0 ? "‹ " : ""}</S>
      <For each={shown()}>
        {(t, i) => {
          const current = () => t.tile.selection === data.state.accountSelection
          const bg = () => (current() && props.focused ? theme.surface0 : theme.canvas)
          const cell = () => part(t.tile, current())
          return (
            <>
              <S fg={theme.surface1}>{i() === 0 ? "" : t.groupStart ? " │ " : " ".repeat(GAP)}</S>
              <S fg={cell().fg} bg={bg()} bold={cell().bold}>{fit(cell().text, t.width)}</S>
            </>
          )
        }}
      </For>
      <S fg={theme.overlay1}>{window().end < tiles().length ? " ›" : ""}</S>
    </text>
  )

  return (
    <SectionCard title="Accounts" focused={props.focused} active={props.focused} height={STRIP_HEIGHT} bottomSpans={bottom()}>
      <Show when={tiles().length > 1} fallback={<text fg={theme.overlay1}>No accounts yet</text>}>
        {line((tile, current) => ({ text: `${current ? "▸" : " "} ${tile.label}`, fg: current ? theme.text : theme.subtext0, bold: current }))}
        {line((tile) => ({ text: `  ${tile.balance != null ? formatMoney(tile.balance) : "—"}`, fg: tile.balance != null && tile.balance < 0 ? theme.error : theme.subtext1 }))}
      </Show>
    </SectionCard>
  )
}

/** A tile's content width: its name or its balance, whichever is wider. */
function tileWidth(tile: AccountTile): number {
  return Math.max(Bun.stringWidth(tile.label), tile.balance != null ? formatMoney(tile.balance).length : 1)
}

/** Which tiles fit in `width` cells, keeping `selected` in view: as many
 * before it as fit, then as many after. Tiles are `GAP` apart; a cut-off
 * side takes `MORE` cells for its mark. */
export function stripWindow(widths: number[], selected: number, width: number): { start: number; end: number } {
  const span = (start: number, end: number) =>
    widths.slice(start, end).reduce((sum, w) => sum + w, 0) + GAP * (end - start - 1) +
    (start > 0 ? MORE : 0) + (end < widths.length ? MORE : 0)
  if (span(0, widths.length) <= width) return { start: 0, end: widths.length }
  let start = 0
  while (start < selected && span(start, selected + 1) > width) start++
  let end = selected + 1
  while (end < widths.length && span(start, end + 1) <= width) end++
  return { start, end }
}
