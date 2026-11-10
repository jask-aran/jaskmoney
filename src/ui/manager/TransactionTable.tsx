import { onPointer } from "../../app/pointer"
import { moveTxnCursor, openTransaction } from "../../app/keys"
import { ui } from "../../state/uiStore"
import { Index, Show, createMemo } from "solid-js"
import { ACCEPT_ALL_AT, MATCH_AT } from "../../domain/questions"
import { StyledLine, type StyledSpan } from "../primitives/StyledLine"
import { padSpans, type Span } from "../primitives/spans"
import { categoryColor, fade, isUncategorisedColor, ink, tone, theme } from "../../theme"
import { data } from "../../state/dataStore"
import { formatMoney } from "../../domain/dashboard"
import { rowAppearance } from "../../domain/rowStyle"
import type { Transaction } from "../../domain/types"
import { fit } from "../text"
import { categoryMark } from "../icons"
import { boughtText } from "../../domain/history"
import { amountColor } from "../colors"

const columns = {
  marker: 1,
  gap: 1,
  date: 9,
  amount: 13,
  account: 12,
  category: 16,
} as const

const DESCRIPTION_MAX = 36
const CATEGORY_MIN = 16
const TAGS_MIN = 8

function tableLayout(
  contentWidth: number,
  showAccount: boolean,
  showTags: boolean,
  longest: { description: number; category: number },
): { description: number; category: number; tags: number; showAccount: boolean; showTags: boolean } {
  const fixed = columns.marker + columns.date + columns.amount + 3 * columns.gap +
    (showTags ? columns.gap : 0) + (showAccount ? columns.account + columns.gap : 0)
  const avail = contentWidth - fixed
  const tagsMin = showTags ? TAGS_MIN : 0
  const description = Math.max(5, Math.min(longest.description, DESCRIPTION_MAX, avail - CATEGORY_MIN - tagsMin))
  const category = Math.max(CATEGORY_MIN, Math.min(longest.category, avail - description - tagsMin))
  const rest = Math.max(0, avail - description - category)
  return showTags
    ? { description, category, tags: Math.max(1, rest), showAccount, showTags }
    : { description, category: category + rest, tags: 0, showAccount, showTags }
}

const longest = () => ({
  description: Math.max("Description ▼".length, ...data.transactions().map((t) => Bun.stringWidth(t.description.trimEnd()) + (t.bought?.length ? 3 + Bun.stringWidth(boughtText(t)) : 0))),
  category: 2 + Math.max("Category ▼".length - 2, ...data.state.categories.map((c) => Bun.stringWidth(c.name))),
})

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y.slice(2)}`
}

interface CategoryCell { marker: string; markerColor: string; text: string; textColor: string; muted: boolean; italic?: boolean; note?: string; noteColor?: string; lead?: string; leadColor?: string }

function formatCategory(
  categoryId: number | null,
  name: string,
  color: string | undefined,
  width: number,
): CategoryCell {
  const muted = !name || name === "Uncategorised" || isUncategorisedColor(color)
  const text = name || "Uncategorised"
  return {
    marker: `${categoryMark(categoryId, muted)} `,
    markerColor: categoryColor(color),
    text: fit(text, width - 2),
    textColor: categoryColor(color),
    muted,
  }
}

function confidenceColor(confidence: number): string {
  return confidence >= ACCEPT_ALL_AT ? tone.good : confidence >= 0.5 ? tone.caution : ink.note
}

function withAskScore(cell: CategoryCell, score: number | undefined, width: number): CategoryCell {
  if (score == null) return cell
  const near = score < MATCH_AT
  const note = `${near ? "≈" : ""}${Math.round(score * 100)}%`.padStart(5)
  return { ...cell, text: fit(cell.text.trimEnd(), width - 2 - note.length), note, noteColor: near ? tone.caution : tone.good }
}

const PROVISIONAL_FADE = 0.35

function formatSuggestion(suggestion: TableSuggestion | undefined, width: number): CategoryCell {
  const category = suggestion && data.state.categories.find((c) => c.id === suggestion.categoryId)
  if (!suggestion || !category) {
    return { marker: `${categoryMark(null, true)} `, markerColor: ink.note, text: fit(data.state.suggesting ? "suggesting…" : "no suggestion", width - 2), textColor: ink.note, muted: true }
  }
  const lead = `${suggestion.source === "history" ? "↺" : ""}${Math.round(suggestion.confidence * 100)}% `.padStart(6)
  const color = fade(categoryColor(category.color), PROVISIONAL_FADE)
  return {
    lead,
    leadColor: confidenceColor(suggestion.confidence),
    marker: `${categoryMark(category.id)} `,
    markerColor: color,
    text: fit(category.name, width - 2 - lead.length),
    textColor: color,
    muted: false,
    italic: true,
  }
}

function formatDetails(t: Transaction, width: number): Span[] {
  const bought = boughtText(t)
  if (bought) return [{ text: fit(bought, width), fg: ink.label }]
  if (t.message) return [{ text: fit(t.message, width), fg: ink.label }]
  return formatTags(t.tagNames, t.tagColors, width)
}

function describe(t: Transaction, width: number, details: boolean): string[] {
  const bought = details ? "" : boughtText(t)
  const name = t.description.trimEnd()
  if (!bought || Bun.stringWidth(name) + 4 > width) return [fit(t.description, width)]
  return [name, fit(` · ${bought}`, width - Bun.stringWidth(name))]
}

interface TableSuggestion { categoryId: number; confidence: number; source: "history" | "jev" }

function formatTags(names: string[], colors: string[], width: number): Span[] {
  if (!names.length) return [{ text: "-".padEnd(width), fg: ink.faint }]
  const spans = names.flatMap((name, i): Span[] => [
    ...(i > 0 ? [{ text: ", ", fg: ink.rule }] : []),
    { text: name, fg: colors[i] || theme.blue },
  ])
  return padSpans(spans, width)
}

function formatTagCandidate(candidate: TableTagCandidate, names: string[], colors: string[], width: number): Span[] {
  const mark = candidate.source === "history" ? "↺" : candidate.source === "group" ? "◆" : ""
  const spans: Span[] = [
    { text: `+${candidate.name}`, fg: candidate.color },
    { text: ` ${mark}${Math.round(candidate.confidence * 100)}%`, fg: confidenceColor(candidate.confidence) },
    ...names.flatMap((name, i): Span[] => [{ text: ", ", fg: ink.rule }, { text: name, fg: colors[i] || theme.blue }]),
  ]
  return padSpans(spans, width)
}

export interface TableTagCandidate { name: string; color: string; confidence: number; source: "group" | "history" | "jev" }

function pendingMark(): string {
  return data.state.icons ? "\uf017" : "◷"
}

interface TableProps {
  rows: Transaction[]
  top: number
  visible: number
  cursor: number | null
  width: number
  showAccount: boolean
  showTags: boolean
  selectedIds?: Record<number, boolean>
  highlighted?: Record<number, boolean>
  sortMark?: (column: string) => string
  empty: string
  suggestions?: Record<number, TableSuggestion>
  askScore?: (id: number) => number | undefined
  tagCandidate?: (id: number) => TableTagCandidate | undefined
  nearMiss?: (id: number) => boolean
  reveal?: number
}

type Layout = ReturnType<typeof tableLayout>

export function TransactionTable(props: TableProps) {
  const widest = createMemo(longest)
  const layout = createMemo(() => tableLayout(props.width, props.showAccount, props.showTags, widest()))
  const windowRows = createMemo(() => props.rows.slice(props.top, props.top + props.visible))
  const rowsIn = () => (props.reveal == null || props.reveal >= 1 ? Infinity : Math.ceil(props.reveal * windowRows().length))
  return (
    <box flexGrow={1} width="100%" flexDirection="column" onMouseScroll={onPointer((scope) => scope === "bar" || scope === "manager.txns" || scope === "manager.accounts", (event) => {
      if (event.scroll?.direction !== "up" && event.scroll?.direction !== "down") return
      ui.applyJump("mgr.transactions")
      moveTxnCursor(ui, data, (event.scroll.direction === "down" ? 3 : -3) * event.scroll.delta, false)
    })}>
      <TableHeader table={props} layout={layout} />
      <Show when={props.rows.length} fallback={<text fg={ink.note}>{props.empty}</text>}>
        <box flexGrow={1} flexDirection="column">
          <Index each={windowRows()}>
            {(r, i) => <TransactionRow table={props} layout={layout} r={r} i={i} rowsIn={rowsIn} />}
          </Index>
        </box>
      </Show>
    </box>
  )
}

function TableHeader(props: { table: TableProps; layout: () => Layout }) {
  const mark = (column: string) => props.table.sortMark?.(column) ?? ""
  const layout = props.layout
  return (
    <text fg={ink.label}>
      <b>
        {" ".repeat(columns.marker)}
        {`Date${mark("date")}`.padEnd(columns.date)}
        {" ".repeat(columns.gap)}
        {`Amount${mark("amount")}`.padEnd(columns.amount)}
        {" ".repeat(columns.gap)}
        {fit(`Description${mark("description")}`, layout().description)}
        {layout().showAccount ? " ".repeat(columns.gap) + `Account${mark("account")}`.padEnd(columns.account) : ""}
        {" ".repeat(columns.gap)}
        {`Category${mark("category")}`.padEnd(layout().category)}
        {layout().showTags ? " ".repeat(columns.gap) + fit(props.table.suggestions ? "Details" : "Tags", layout().tags) : ""}
      </b>
    </text>
  )
}

function TransactionRow(row: { table: TableProps; layout: () => Layout; r: () => Transaction; i: number; rowsIn: () => number }) {
  const props = row.table
  const { layout, r, i, rowsIn } = row
  const absIndex = () => props.top + i
  const isCursor = () => props.cursor === absIndex()
  const selected = createMemo(() => !!props.selectedIds?.[r().id])
  const hl = createMemo(() => !!props.highlighted?.[r().id])
  const look = createMemo(() => rowAppearance(selected(), hl(), isCursor()))
  const rowBg = () => look().bg ?? theme.canvas
  const fg = (column: string) => look().fg ?? column
  const near = createMemo(() => !!props.nearMiss?.(r().id))
  const faint = (column: string) => look().fg ?? (near() ? ink.note : column)
  const held = () => r().status === "HELD"
  const tags = createMemo(() => {
    if (props.suggestions) return formatDetails(r(), layout().tags)
    const candidate = props.tagCandidate?.(r().id)
    return candidate ? formatTagCandidate(candidate, r().tagNames, r().tagColors, layout().tags) : formatTags(r().tagNames, r().tagColors, layout().tags)
  })
  const category = createMemo(() => props.suggestions
    ? formatSuggestion(props.suggestions[r().id], layout().category)
    : withAskScore(formatCategory(r().categoryId, r().categoryName, r().categoryColor, layout().category), props.askScore?.(r().id), layout().category))
  const strong = () => look().bold
  const line = createMemo((): StyledSpan[] => {
    const bg = rowBg(), bold = strong(), cat = category(), catBold = bold && (!cat.muted || !!look().fg)
    return [
      { text: selected() ? "*" : near() ? "≈" : " ", fg: fg(tone.key), bg, bold },
      { text: fmtDate(r().dateISO).padEnd(columns.date), fg: faint(ink.label), bg, bold },
      { text: " ".repeat(columns.gap), fg: fg(ink.figure), bg, bold },
      { text: formatMoney(r().amount).padEnd(columns.amount - 2), fg: faint(amountColor(r().amount)), bg, bold, italic: held() },
      { text: held() ? `${pendingMark()} ` : "  ", fg: fg(ink.note), bg },
      { text: " ".repeat(columns.gap), fg: fg(ink.figure), bg, bold },
      ...describe(r(), layout().description, !!props.suggestions).map((part, k) => ({ text: part, fg: k ? faint(ink.note) : faint(ink.figure), bg, bold: bold && !k, italic: held() })),
      { text: layout().showAccount ? " ".repeat(columns.gap) + fit(r().accountName, columns.account) : "", fg: fg(ink.label), bg, bold },
      { text: " ".repeat(columns.gap), fg: fg(ink.figure), bg, bold },
      ...(cat.lead ? [{ text: cat.lead, fg: fg(cat.leadColor ?? ink.note), bg }] : []),
      { text: cat.marker, fg: fg(cat.markerColor), bg, bold: catBold },
      { text: cat.text, fg: fg(cat.textColor), bg, bold: catBold, dim: cat.muted && !look().fg, italic: cat.italic },
      { text: cat.note ?? "", fg: fg(cat.noteColor ?? ink.note), bg },
      ...(layout().showTags ? [
        { text: " ".repeat(columns.gap), fg: fg(ink.figure), bg, bold },
        ...tags().map((span) => ({ text: span.text, fg: fg(span.fg), bg, bold })),
      ] : []),
    ]
  })
  return <box height={1} width="100%" onMouseDown={onPointer((scope) => scope === "bar" || scope === "manager.txns" || scope === "manager.accounts", () => {
    const open = ui.state.focusedSection === "mgr.transactions" && ui.state.managerCursor === absIndex()
    ui.applyJump("mgr.transactions")
    moveTxnCursor(ui, data, absIndex() - ui.state.managerCursor, false)
    if (open) openTransaction(ui, data)
  })}><StyledLine spans={i < rowsIn() ? line() : []} bg={i < rowsIn() ? rowBg() : theme.canvas} /></box>
}
