import { Show, createMemo, type JSX } from "solid-js"
import { categoryMark } from "../icons"
import { useTerminalDimensions } from "@opentui/solid"
import { Modal } from "../primitives/Modal"
import { S } from "../primitives/S"
import { TextInput } from "../primitives/TextInput"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { categoryColor, theme } from "../../theme"
import { formatMoney } from "../../domain/dashboard"
import { amountColor } from "../colors"

const LABEL = 12

/** Detail view for one transaction (enter in the Manager table). Rows with no
 * value are left out. */
export function TransactionDetail() {
  const dims = useTerminalDimensions()
  const row = createMemo(() => data.state.transactions.find((t) => t.id === ui.state.detailId) ?? null)
  // Re-read provider details whenever the transaction list refreshes.
  const detail = createMemo(() => {
    void data.state.transactions
    const id = ui.state.detailId
    return id == null ? null : data.transactionDetail(id)
  })
  const field = (label: string, value: JSX.Element) => (
    <text wrapMode="none">
      <S fg={theme.subtext0}>{label.padEnd(LABEL)}</S>
      {value}
    </text>
  )

  return (
    <Show when={row() && detail()}>
      <Modal title={row()!.description} tone="focus" width={Math.floor(dims().width * 0.76)}>
        {field("Amount", <S fg={amountColor(row()!.amount)} bold>{formatMoney(row()!.amount)}</S>)}
        {field("Date", <S fg={theme.text}>{formatWhen(detail()!.createdAt) ?? row()!.dateISO}</S>)}
        <Show when={detail()!.status}>
          {field(
            "Status",
            detail()!.status === "HELD"
              ? <S fg={theme.warning}>Pending</S>
              : <S fg={theme.text}>{`Settled${detail()!.settledAt ? ` ${formatWhen(detail()!.settledAt)}` : ""}`}</S>,
          )}
        </Show>
        {field("Account", <S fg={theme.text}>{row()!.accountName || "—"}</S>)}
        <Show when={detail()!.transferAccountName}>
          {field("Transfer", <S fg={theme.text}>{`${row()!.amount < 0 ? "to" : "from"} ${detail()!.transferAccountName}`}</S>)}
        </Show>
        {field("Category", <S fg={categoryColor(row()!.categoryColor)}>{`${categoryMark(row()!.categoryId)} ${row()!.categoryName}`}</S>)}
        {field("Tags", <S fg={theme.text}>{row()!.tagNames.length ? row()!.tagNames.join(", ") : "—"}</S>)}
        <Show when={detail()!.transactionType || detail()!.cardMethod}>
          {field("Method", <S fg={theme.text}>{[detail()!.transactionType, cardText(detail()!.cardMethod, detail()!.cardSuffix)].filter(Boolean).join(" · ")}</S>)}
        </Show>
        <Show when={detail()!.foreignAmount}>{field("Foreign", <S fg={theme.text}>{detail()!.foreignAmount!}</S>)}</Show>
        <Show when={detail()!.roundUp != null}>{field("Round-up", <S fg={theme.text}>{formatMoney(detail()!.roundUp!)}</S>)}</Show>
        <Show when={detail()!.cashback != null}>{field("Cashback", <S fg={theme.success}>{formatMoney(detail()!.cashback!)}</S>)}</Show>
        <Show when={detail()!.rawText && detail()!.rawText !== row()!.description}>
          {field("Bank text", <S fg={theme.text}>{detail()!.rawText!}</S>)}
        </Show>
        <Show when={detail()!.message}>{field("Message", <S fg={theme.text}>{detail()!.message!}</S>)}</Show>
        <Show when={detail()!.importFilename}>{field("Imported", <S fg={theme.text}>{detail()!.importFilename!}</S>)}</Show>
        <Show
          when={ui.state.detailNotesEditing}
          fallback={field("Notes", <S fg={row()!.notes ? theme.text : theme.overlay1}>{row()!.notes || "—"}</S>)}
        >
          {field("Notes", <TextInput field={{ value: ui.state.detailNotesDraft, caret: ui.state.detailNotesCaret }} focused />)}
        </Show>
      </Modal>
    </Show>
  )
}

/** "CARD_ON_FILE" → "Card on file", with "··1234" when the suffix is known. */
function cardText(method: string | null, suffix: string | null): string | null {
  if (!method) return null
  const words = method.toLowerCase().replace(/_/g, " ")
  return `${words[0]!.toUpperCase()}${words.slice(1)}${suffix ? ` ··${suffix}` : ""}`
}

/** RFC 3339 with offset → "Sun 26 Oct 2026, 9:14 pm" in local time. */
function formatWhen(iso: string | null): string | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return new Date(t).toLocaleString("en-AU", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" })
}
