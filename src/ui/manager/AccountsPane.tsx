import { For, Show, createMemo } from "solid-js"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { formatMoney } from "../../domain/dashboard"
import { accountStacks, type AccountStack } from "../../domain/accountTree"
import { accountMark } from "../icons"
import { truncate } from "../text"

/** Cells between stacks: " │ ". */
const GAP = 3
/** Cells for the "‹ " and " ›" marks when stacks are cut off. */
const MORE = 2
/** Narrowest a stack is drawn. */
const MIN_STACK = 32
const NET = " · Net position"

/** The pane's height, borders included: a header line per stack, then its
 * rows (the tallest stack sets it). */
export function accountsPaneHeight(stacks: AccountStack[]): number {
  return 3 + Math.max(0, ...stacks.map((stack) => stack.rows.length))
}

interface Cell { text: string; fg: string; bg?: string; bold?: boolean }

/** The Transactions tab's accounts, above the table: a stack per bank with
 * its net position, then its spending accounts and savers. The selected row
 * is marked, and highlighted while the pane has focus. */
export function AccountsPane(props: { focused: boolean; width: number }) {
  const stacks = createMemo(() => accountStacks(data.state.accounts))
  const money = (n: number | null) => (n != null ? formatMoney(n) : "—")
  const mark = (kind: Parameters<typeof accountMark>[0]) => (accountMark(kind) ? `${accountMark(kind)} ` : "")
  // Every stack is as wide as the widest needs, so their figures line up.
  const width = createMemo(() => Math.min(props.width - 4, Math.max(MIN_STACK, ...stacks().flatMap((stack) => [
    Bun.stringWidth(mark("net") + stack.label + NET) + 2 + money(stack.net).length,
    ...stack.rows.map((row) => 2 + Bun.stringWidth(mark(row.kind) + row.label) + 2 + money(row.balance).length),
  ]))))
  const selected = () => Math.max(0, stacks().findIndex((stack) => stack.rows.some((row) => row.selection === data.state.accountSelection)))
  const window = createMemo(() => stripWindow(stacks().map(() => width()), selected(), props.width - 4))
  const shown = () => stacks().slice(window().start, window().end)
  const lines = () => Array.from({ length: accountsPaneHeight(stacks()) - 2 }, (_, i) => i)

  /** One line of a stack: text on the left, a figure flush right. */
  const line = (left: Cell[], right: Cell, bg: string): Cell[] => {
    const room = width() - right.text.length - 1
    let used = 0
    const fitted = left.map((cell) => {
      const text = truncate(cell.text, Math.max(0, room - used))
      used += Bun.stringWidth(text)
      return { ...cell, text, bg }
    })
    return [...fitted, { text: " ".repeat(Math.max(1, width() - used - right.text.length)), fg: theme.text, bg }, { ...right, bg }]
  }
  const cells = (stack: AccountStack, index: number): Cell[] => {
    if (index === 0) {
      return line([
        { text: mark("net"), fg: theme.blue },
        { text: stack.label, fg: theme.text, bold: true },
        { text: NET, fg: theme.overlay1 },
      ], { text: money(stack.net), fg: stack.net != null && stack.net < 0 ? theme.error : theme.text, bold: true }, theme.canvas)
    }
    const row = stack.rows[index - 1]
    if (!row) return [{ text: " ".repeat(width()), fg: theme.text }]
    const current = row.selection === data.state.accountSelection
    return line([
      { text: current ? "▸ " : "  ", fg: theme.accent, bold: true },
      { text: mark(row.kind), fg: row.kind === "savers" ? theme.success : theme.lavender },
      { text: row.label, fg: current ? theme.text : theme.subtext0, bold: current },
    ], { text: money(row.balance), fg: row.balance != null && row.balance < 0 ? theme.error : theme.subtext1 }, current && props.focused ? theme.surface0 : theme.canvas)
  }

  return (
    <SectionCard title="Accounts" focused={props.focused} active={props.focused} height={accountsPaneHeight(stacks())}>
      <Show when={stacks().length} fallback={<text fg={theme.overlay1}>No accounts yet</text>}>
        <For each={lines()}>
          {(index) => (
            <text wrapMode="none">
              <S fg={theme.overlay1}>{window().start > 0 ? "‹ " : ""}</S>
              <For each={shown()}>
                {(stack, i) => (
                  <>
                    <S fg={theme.surface1}>{i() === 0 ? "" : " │ "}</S>
                    <For each={cells(stack, index)}>{(cell) => <S fg={cell.fg} bg={cell.bg ?? theme.canvas} bold={cell.bold}>{cell.text}</S>}</For>
                  </>
                )}
              </For>
              <S fg={theme.overlay1}>{window().end < stacks().length ? " ›" : ""}</S>
            </text>
          )}
        </For>
      </Show>
    </SectionCard>
  )
}

/** Which stacks fit in `width` cells, keeping `selected` in view: as many
 * before it as fit, then as many after. Stacks are `GAP` apart; a cut-off
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
