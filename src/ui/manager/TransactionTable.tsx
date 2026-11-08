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

/**
 * The Transactions tab's table: header, then the rows in view. Cursor, selection and range are
 * independent states styled by rowAppearance. Pending (held) rows are
 * italic with a grey clock after the amount.
 */
const columns = {
  marker: 1,
  gap: 1,
  date: 9,
  /** The amount, then a pending marker. */
  amount: 13,
  account: 12,
  category: 16,
} as const

/** Widest the description goes: longer ones (a rare few in Up's data run to
 * 54) are cut rather than pushing the category across. */
const DESCRIPTION_MAX = 36
/** Narrowest the category and tags go before the description gives way. */
const CATEGORY_MIN = 16
const TAGS_MIN = 8

/** Column widths. The description gets its longest text up to
 * DESCRIPTION_MAX, then the category its
 * longest name, while both fit beside the minimums; tags, or without them
 * the category, take the rest so row backgrounds span the table. As in Go
 * (hasMultipleAccountNames), the Account column only shows for several
 * accounts. */
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

/** The widest description and category (with its marker) in the data, or
 * their headings with a sort mark. Every transaction counts, not just the
 * rows shown, so a filter or account switch never moves the columns. */
const longest = () => ({
  // With what a row bought after it (cut at DESCRIPTION_MAX all the same).
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

/** How sure a suggestion is, at a glance: sure enough for accept-all, worth
 * a look, or a guess. */
function confidenceColor(confidence: number): string {
  return confidence >= ACCEPT_ALL_AT ? tone.good : confidence >= 0.5 ? tone.caution : ink.note
}

/** A category cell with how likely the row matches the `ask:` terms: a
 * match's probability in green, a near miss's (≈) in amber. */
function withAskScore(cell: CategoryCell, score: number | undefined, width: number): CategoryCell {
  if (score == null) return cell
  const near = score < MATCH_AT
  const note = `${near ? "≈" : ""}${Math.round(score * 100)}%`.padStart(5)
  return { ...cell, text: fit(cell.text.trimEnd(), width - 2 - note.length), note, noteColor: near ? tone.caution : tone.good }
}

/** How far a suggested category's colour fades toward the canvas: it's
 * provisional until accepted. */
const PROVISIONAL_FADE = 0.35

/** A suggested category: its confidence first (↺ when it comes from
 * history), then the category faded and in italics; or why there is none yet. */
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

/** The Uncategorised view's Details cell: what the row bought, else the
 * bank's message, else its tags. */
function formatDetails(t: Transaction, width: number): Span[] {
  const bought = boughtText(t)
  if (bought) return [{ text: fit(bought, width), fg: ink.label }]
  if (t.message) return [{ text: fit(t.message, width), fg: ink.label }]
  return formatTags(t.tagNames, t.tagColors, width)
}

/** The description cell: the description, then (dimmed) what the row
 * bought, while there's room — except where a Details column shows it. */
function describe(t: Transaction, width: number, details: boolean): string[] {
  const bought = details ? "" : boughtText(t)
  const name = t.description.trimEnd()
  if (!bought || Bun.stringWidth(name) + 4 > width) return [fit(t.description, width)]
  return [name, fit(` · ${bought}`, width - Bun.stringWidth(name))]
}

/** What the table needs of a category suggestion. */
interface TableSuggestion { categoryId: number; confidence: number; source: "history" | "jev" }

/** Every tag in its own colour, comma-joined and cut to `width` (Go app). */
function formatTags(names: string[], colors: string[], width: number): Span[] {
  if (!names.length) return [{ text: "-".padEnd(width), fg: ink.faint }]
  const spans = names.flatMap((name, i): Span[] => [
    ...(i > 0 ? [{ text: ", ", fg: ink.rule }] : []),
    { text: name, fg: colors[i] || theme.blue },
  ])
  return padSpans(spans, width)
}

/** A tag review's candidate in the Tags cell: the proposed tag, its
 * confidence coloured as a suggestion's (↺ from tag history, ◆ from a
 * detected trip or group), then the row's own tags. */
function formatTagCandidate(candidate: TableTagCandidate, names: string[], colors: string[], width: number): Span[] {
  const mark = candidate.source === "history" ? "↺" : candidate.source === "group" ? "◆" : ""
  const spans: Span[] = [
    { text: `+${candidate.name}`, fg: candidate.color },
    { text: ` ${mark}${Math.round(candidate.confidence * 100)}%`, fg: confidenceColor(candidate.confidence) },
    ...names.flatMap((name, i): Span[] => [{ text: ", ", fg: ink.rule }, { text: name, fg: colors[i] || theme.blue }]),
  ]
  return padSpans(spans, width)
}

/** What the table needs of a tag review's candidate. */
export interface TableTagCandidate { name: string; color: string; confidence: number; source: "group" | "history" | "jev" }

/** The marker after a pending amount: a clock icon, or ◷ without icons. */
function pendingMark(): string {
  return data.state.icons ? "\uf017" : "◷"
}

export function TransactionTable(props: {
  rows: Transaction[]
  /** Index of the first row in view, and how many fit. */
  top: number
  visible: number
  /** Absolute cursor index; null when the table is not focused. */
  cursor: number | null
  /** Content width (inside the card's border and padding). */
  width: number
  showAccount: boolean
  showTags: boolean
  selectedIds?: Record<number, boolean>
  highlighted?: Record<number, boolean>
  sortMark?: (column: string) => string
  empty: string
  /** Given (the Uncategorised view): the Category column shows these instead. */
  suggestions?: Record<number, TableSuggestion>
  /** Given (near misses shown): how likely each row matches the `ask:` terms,
   * shown after its category. */
  askScore?: (id: number) => number | undefined
  /** Given (a tag review): each row's candidate, shown in the Tags column. */
  tagCandidate?: (id: number) => TableTagCandidate | undefined
  /** Rows shown only as near misses: marked ≈ and dimmed, after the matches. */
  nearMiss?: (id: number) => boolean
  /** How far the rows have drawn in (0–1): those past it, top to bottom,
   * not yet drawn. */
  reveal?: number
}) {
  const widest = createMemo(longest)
  const layout = createMemo(() => tableLayout(props.width, props.showAccount, props.showTags, widest()))
  const mark = (column: string) => props.sortMark?.(column) ?? ""
  const windowRows = createMemo(() => props.rows.slice(props.top, props.top + props.visible))
  const rowsIn = () => (props.reveal == null || props.reveal >= 1 ? Infinity : Math.ceil(props.reveal * windowRows().length))
  return (
    <box flexGrow={1} width="100%" flexDirection="column" onMouseScroll={onPointer((scope) => scope === "bar" || scope === "manager.txns" || scope === "manager.accounts", (event) => {
      if (event.scroll?.direction !== "up" && event.scroll?.direction !== "down") return
      ui.applyJump("mgr.transactions")
      moveTxnCursor(ui, data, (event.scroll.direction === "down" ? 3 : -3) * event.scroll.delta, false)
    })}>
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
          {layout().showTags ? " ".repeat(columns.gap) + fit(props.suggestions ? "Details" : "Tags", layout().tags) : ""}
        </b>
      </text>
      <Show when={props.rows.length} fallback={<text fg={ink.note}>{props.empty}</text>}>
        <box flexGrow={1} flexDirection="column">
          {/* Index keeps each screen row and updates it in place: a filter
              that changes every row would otherwise rebuild them all. */}
          <Index each={windowRows()}>
            {(r, i) => {
              const absIndex = () => props.top + i
              const isCursor = () => props.cursor === absIndex()
              // Booleans as memos: the maps they read are rebuilt whole on a
              // write, and a row whose own state didn't change must not redraw.
              const selected = createMemo(() => !!props.selectedIds?.[r().id])
              const hl = createMemo(() => !!props.highlighted?.[r().id])
              // OpenTUI cannot repaint a previous cell to transparency: it must
              // receive the table canvas colour when a row loses its state bg.
              // This is visually identical to the unstyled table background.
              const look = createMemo(() => rowAppearance(selected(), hl(), isCursor()))
              const rowBg = () => look().bg ?? theme.canvas
              const fg = (column: string) => look().fg ?? column
              // A near miss reads quieter than a match, unless cursor, selection or range colour it.
              const near = createMemo(() => !!props.nearMiss?.(r().id))
              const faint = (column: string) => look().fg ?? (near() ? ink.note : column)
              // Up holds (pending) render italic, with a clock, until they settle.
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
              // One styled line (StyledLine), not a span per cell: a page
              // or a sort rewrites every row.
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
            }}
          </Index>
        </box>
      </Show>
    </box>
  )
}
