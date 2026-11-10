import { For, Show, createMemo, createResource, type JSX } from "solid-js"
import { categoryMark } from "../icons"
import { useTerminalDimensions } from "@opentui/solid"
import { Modal } from "../primitives/Modal"
import { S } from "../primitives/S"
import { TextInput } from "../primitives/TextInput"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { categoryColor, ink, tone } from "../../theme"
import { formatMoney } from "../../domain/dashboard"
import { amountColor } from "../colors"
import { fit } from "../text"
import { marketplaceRows } from "../../ai/orderEmails"
import { executorSignedIn } from "../../ai/executor"
import type { Transaction } from "../../domain/types"
import type { TextField } from "../../domain/textField"
import type { TransactionDetail as TransactionDetailInfo } from "../../db/client"

const LABEL = 12
export const BOUGHT_LINES = 10
const BOUGHT_PRICE = 14

const ago = (iso: string) => {
  const minutes = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000))
  return minutes < 60 ? `${minutes}m ago` : minutes < 48 * 60 ? `${Math.round(minutes / 60)}h ago` : `${Math.round(minutes / 1440)}d ago`
}

export function TransactionDetail() {
  const dims = useTerminalDimensions()
  const row = createMemo(() => data.transactions().find((t) => t.id === (ui.state.detail?.id ?? null)) ?? null)
  const [fetched] = createResource(
    () => (ui.state.detail ? { id: ui.state.detail.id, version: data.state.version } : false),
    ({ id }) => data.transactionDetail(id).catch(() => null),
  )
  const detail = createMemo(() => {
    const d = fetched.latest
    return d && d.id === (ui.state.detail?.id ?? null) ? d : null
  })
  const lookup = createMemo(() => {
    const t = row()
    if (!t || t.bought?.length || !marketplaceRows([t]).length || !executorSignedIn()) return null
    const l = data.purchaseLookups().get(t.id)
    if (!l || l.status === "waiting") return `looking for its order email${l ? ` · checked ${ago(l.checkedAt)}` : " at the next sync"}`
    return l.status === "none" ? "no order email found" : null
  })
  return (
    <Show when={row()}>
      {(r: () => Transaction) => (
        <TransactionDetailCard row={r()} detail={detail()} boughtTop={ui.state.detail?.boughtTop ?? 0} lookup={lookup()}
          notes={ui.state.detail?.notes != null ? { value: ui.state.detail.notes.draft, caret: ui.state.detail.notes.caret } : null}
          width={Math.floor(dims().width * 0.76)} />
      )}
    </Show>
  )
}

export function TransactionDetailCard(props: {
  row: Transaction
  detail: TransactionDetailInfo | null
  boughtTop: number
  lookup: string | null
  notes: TextField | null
  width: number
}) {
  const row = () => props.row
  const detail = () => props.detail
  const lookup = () => props.lookup
  const boughtLines = createMemo(() => {
    const items = row().bought ?? []
    const top = Math.max(0, Math.min(props.boughtTop, items.length - BOUGHT_LINES))
    return { shown: items.slice(top, top + BOUGHT_LINES), from: top + 1, to: Math.min(items.length, top + BOUGHT_LINES), total: items.length }
  })
  const boughtNameWidth = () => Math.max(10, props.width - 4 - LABEL - 5 - BOUGHT_PRICE)
  const field = (label: string, value: JSX.Element) => (
    <text wrapMode="none">
      <S fg={ink.label}>{label.padEnd(LABEL)}</S>
      {value}
    </text>
  )

  return (
      <Modal title={row()!.description} tone="focus" width={props.width}>
        {field("Amount", <S fg={amountColor(row()!.amount)} bold>{formatMoney(row()!.amount)}</S>)}
        {field("Date", <S fg={ink.figure}>{formatWhen(detail()?.createdAt ?? null) ?? row()!.dateISO}</S>)}
        <Show when={detail()?.status}>
          {field(
            "Status",
            detail()?.status === "HELD"
              ? <S fg={ink.note}>Pending</S>
              : <S fg={ink.figure}>{`Settled${detail()?.settledAt ? ` ${formatWhen(detail()?.settledAt ?? null)}` : ""}`}</S>,
          )}
        </Show>
        {field("Account", <S fg={ink.figure}>{row()!.accountName || "—"}</S>)}
        <Show when={detail()?.transferAccountName}>
          {field("Transfer", <S fg={ink.figure}>{`${row()!.amount < 0 ? "to" : "from"} ${detail()?.transferAccountName}`}</S>)}
        </Show>
        {field("Category", <S fg={categoryColor(row()!.categoryColor)}>{`${categoryMark(row()!.categoryId)} ${row()!.categoryName}`}</S>)}
        {field("Tags", <S fg={ink.figure}>{row()!.tagNames.length ? row()!.tagNames.join(", ") : "—"}</S>)}
        <Show when={detail()?.transactionType || detail()?.cardMethod}>
          {field("Method", <S fg={ink.figure}>{[detail()?.transactionType, cardText(detail()?.cardMethod ?? null, detail()?.cardSuffix ?? null)].filter(Boolean).join(" · ")}</S>)}
        </Show>
        <Show when={detail()?.foreignAmount}>{field("Foreign", <S fg={ink.figure}>{detail()?.foreignAmount!}</S>)}</Show>
        <Show when={detail()?.roundUp != null}>{field("Round-up", <S fg={ink.figure}>{formatMoney(detail()?.roundUp!)}</S>)}</Show>
        <Show when={detail()?.cashback != null}>{field("Cashback", <S fg={tone.good}>{formatMoney(detail()?.cashback!)}</S>)}</Show>
        <Show when={detail()?.rawText && detail()?.rawText !== row()!.description}>
          {field("Bank text", <S fg={ink.figure}>{detail()?.rawText!}</S>)}
        </Show>
        <Show when={detail()?.message}>{field("Message", <S fg={ink.figure}>{detail()?.message!}</S>)}</Show>
        <Show when={row()!.bought?.length} fallback={<Show when={lookup()}>{field("Bought", <S fg={ink.note}>{lookup()!}</S>)}</Show>}>
          <For each={boughtLines().shown}>{(item, i) => field(i() === 0 ? "Bought" : "", <>
            <S fg={ink.note}>{`${item.quantity}×`.padStart(4)} </S>
            <S fg={ink.figure}>{fit(item.name, boughtNameWidth())}</S>
            <S fg={ink.figure}>{(item.price == null ? "" : `${formatMoney(item.price)}${item.quantity > 1 ? " ea" : ""}`).padStart(BOUGHT_PRICE)}</S>
          </>)}</For>
          <Show when={boughtLines().total > BOUGHT_LINES}>
            {field("", <S fg={ink.note}>{`${boughtLines().from}–${boughtLines().to} of ${boughtLines().total} · J/K scroll`}</S>)}
          </Show>
        </Show>
        <Show when={detail()?.importFilename}>{field("Imported", <S fg={ink.figure}>{detail()?.importFilename!}</S>)}</Show>
        <Show
          when={props.notes}
          fallback={field("Notes", <S fg={row()!.notes ? ink.figure : ink.faint}>{row()!.notes || "—"}</S>)}
        >
          {(notes: () => TextField) => field("Notes", <TextInput field={notes()} focused />)}
        </Show>
      </Modal>
  )
}

function cardText(method: string | null, suffix: string | null): string | null {
  if (!method) return null
  const words = method.toLowerCase().replace(/_/g, " ")
  return `${words[0]!.toUpperCase()}${words.slice(1)}${suffix ? ` ··${suffix}` : ""}`
}

function formatWhen(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return new Date(t).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
}
