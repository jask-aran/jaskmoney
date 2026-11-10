import { Index, createMemo } from "solid-js"
import { formatMoney, formatWholeMoney, signedWholeMoney } from "../../domain/dashboard"
import { type SectionId } from "../../state/uiStore"
import { ink } from "../../theme"
import { changeColor } from "../colors"
import { S } from "../primitives/S"
import { SectionCard } from "../primitives/SectionCard"
import type { Span } from "../primitives/spans"
import { regionRef } from "../regions"
import { fit } from "../text"

import type { OverviewModel } from "./overviewModel"
import type { OverviewLayout } from "./OverviewTab"
import { panePointer } from "./RangePane"

type AccountInput = OverviewModel & OverviewLayout & { focused: () => SectionId }

export function createAccountsCard(input: AccountInput) {
  const { position, saverChanges, change30, stackWidth, hasSavers, saversFull } = input
  const available = () => position().spendingBalance
  const saverChange = (accountId: number) => saverChanges().find((c) => c.accountId === accountId)?.change ?? 0
  const saversTotalChange = () => saverChanges().reduce((sum, c) => sum + c.change, 0)
  const ACCOUNT_VALUE = 11
  const ACCOUNT_CHANGE = 10
  const accountLines = createMemo((): Span[][] => {
    const width = stackWidth() - 1
    const row = (label: string, mid: string, value: string, look: { label?: string; mid?: string; value?: string; bold?: boolean } = {}): Span[] => {
      const midWidth = Math.max(ACCOUNT_CHANGE, mid.length + 1)
      return [
        { text: " ", fg: ink.note },
        { text: fit(label, Math.max(4, width - ACCOUNT_VALUE - midWidth)), fg: look.label ?? ink.label, bold: look.bold },
        { text: mid.padStart(midWidth), fg: look.mid ?? ink.note },
        { text: value.padStart(ACCOUNT_VALUE), fg: look.value ?? ink.figure, bold: look.bold },
      ]
    }
    const p = position()
    const lines: Span[][] = [row("Available", "", available() != null ? formatMoney(available()!) : "—", { label: ink.figure, value: ink.strong, bold: true })]
    if (p.pendingCount > 0 && available() != null) lines.push(row("Balance", `${formatWholeMoney(-p.pendingAmount)} pending · ${p.pendingCount}`, formatMoney(available()! - p.pendingAmount), { value: ink.label }))
    if (!hasSavers()) {
      lines.push(row("30 day change", signedWholeMoney(change30()), "", { mid: changeColor(change30()) }))
      return lines
    }
    lines.push([])
    if (saversFull()) {
      lines.push(row("Savers", "30 days", "", { label: ink.heading, mid: ink.label, bold: true }))
      for (const saver of p.savers) lines.push(row(`  ${saver.name}`, signedWholeMoney(saverChange(saver.accountId)), formatWholeMoney(saver.balance), { mid: changeColor(saverChange(saver.accountId)), value: ink.label }))
      lines.push(row("  Total", signedWholeMoney(saversTotalChange()), formatWholeMoney(p.saversTotal), { mid: changeColor(saversTotalChange()) }))
    } else {
      lines.push(row("Savers", signedWholeMoney(saversTotalChange()), formatWholeMoney(p.saversTotal), { mid: changeColor(saversTotalChange()) }))
    }
    lines.push([])
    lines.push(row("Net position", signedWholeMoney(change30()), p.netPosition != null ? formatMoney(p.netPosition) : "—", { label: ink.figure, mid: changeColor(change30()), value: ink.strong, bold: true }))
    return lines.map((l) => (l.length ? l : [{ text: " ", fg: ink.note }]))
  })
  return { accountLines }
}

export function AccountsCard(input: AccountInput & ReturnType<typeof createAccountsCard>) {
  const { sideWidth, accountsHeight, focused, accountLines } = input
  return (
    <box ref={regionRef("ov.accounts", "overview")} width={sideWidth()} height={accountsHeight()} flexShrink={0} onMouseDown={panePointer("ov.accounts")}>
    <SectionCard title="Accounts" focused={focused() === "ov.accounts"} active={focused() === "ov.accounts"} width={sideWidth()} height={accountsHeight()}>
      <Index each={accountLines()}>{(spans) => (
        <text wrapMode="none" flexShrink={0}><Index each={spans()}>{(span) => <S fg={span().fg} bold={span().bold}>{span().text}</S>}</Index></text>
      )}</Index>
    </SectionCard>
    </box>
  )

}
