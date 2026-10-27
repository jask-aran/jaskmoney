import { Index, Show, createMemo } from "solid-js"
import { ACCEPT_ALL_AT, MATCH_AT } from "../../domain/questions"
import { S } from "../primitives/S"
import { fitSpans, spansWidth, type Span } from "../primitives/spans"
import { categoryColor, isUncategorisedColor, theme } from "../../theme"
import { data } from "../../state/dataStore"
import { formatMoney } from "../../domain/dashboard"
import { rowAppearance } from "../../domain/rowStyle"
import type { Transaction } from "../../domain/types"
import { fit } from "../text"
import { categoryMark } from "../icons"
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
export function tableLayout(
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
  description: Math.max("Description ▼".length, ...data.transactions().map((t) => Bun.stringWidth(t.description.trimEnd()))),
  category: 2 + Math.max("Category ▼".length - 2, ...data.state.categories.map((c) => Bun.stringWidth(c.name))),
})

function fmtDate(iso: string): string {
  const [y, m, d] = iso.split("-")
  if (!y || !m || !d) return iso
  return `${d}-${m}-${y.slice(2)}`
}


interface CategoryCell { marker: string; markerColor: string; text: string; textColor: string; muted: boolean; italic?: boolean; note?: string; noteColor?: string }

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
  return confidence >= ACCEPT_ALL_AT ? theme.success : confidence >= 0.5 ? theme.warning : theme.overlay1
}

/** A category cell with how likely the row matches the `ask:` terms: a
 * match's probability in green, a near miss's (≈) in amber. */
function withAskScore(cell: CategoryCell, score: number | undefined, width: number): CategoryCell {
  if (score == null) return cell
  const near = score < MATCH_AT
  const note = `${near ? "≈" : ""}${Math.round(score * 100)}%`.padStart(5)
  return { ...cell, text: fit(cell.text.trimEnd(), width - 2 - note.length), note, noteColor: near ? theme.warning : theme.success }
}

/** A suggested category, in italics with its confidence (↺ when it comes
 * from history); or why there is none yet. */
function formatSuggestion(suggestion: TableSuggestion | undefined, width: number): CategoryCell {
  const category = suggestion && data.state.categories.find((c) => c.id === suggestion.categoryId)
  if (!suggestion || !category) {
    return { marker: `${categoryMark(null, true)} `, markerColor: theme.overlay1, text: fit(data.state.suggesting ? "suggesting…" : "no suggestion", width - 2), textColor: theme.overlay1, muted: true }
  }
  const note = `${suggestion.source === "history" ? "↺" : ""}${Math.round(suggestion.confidence * 100)}%`.padStart(5)
  return {
    marker: `${categoryMark(category.id)} `,
    markerColor: categoryColor(category.color),
    text: fit(category.name, width - 2 - note.length),
    textColor: categoryColor(category.color),
    muted: false,
    italic: true,
    note,
    noteColor: confidenceColor(suggestion.confidence),
  }
}

/** What the table needs of a category suggestion. */
export interface TableSuggestion { categoryId: number; confidence: number; source: "history" | "jev" }

/** Every tag in its own colour, comma-joined and cut to `width` (Go app). */
function formatTags(names: string[], colors: string[], width: number): Span[] {
  if (!names.length) return [{ text: "-".padEnd(width), fg: theme.overlay1 }]
  const spans = names.flatMap((name, i): Span[] => [
    ...(i > 0 ? [{ text: ", ", fg: theme.overlay1 }] : []),
    { text: name, fg: colors[i] || theme.teal },
  ])
  const fitted = fitSpans(spans, width)
  const used = spansWidth(fitted)
  return used < width ? [...fitted, { text: " ".repeat(width - used), fg: theme.overlay1 }] : fitted
}

/** A tag review's candidate in the Tags cell: the proposed tag, its
 * confidence coloured as a suggestion's (↺ from tag history, ◆ from a
 * detected trip or group), then the row's own tags. */
function formatTagCandidate(candidate: TableTagCandidate, names: string[], colors: string[], width: number): Span[] {
  const mark = candidate.source === "history" ? "↺" : candidate.source === "group" ? "◆" : ""
  const spans: Span[] = [
    { text: `+${candidate.name}`, fg: candidate.color },
    { text: ` ${mark}${Math.round(candidate.confidence * 100)}%`, fg: confidenceColor(candidate.confidence) },
    ...names.flatMap((name, i): Span[] => [{ text: ", ", fg: theme.overlay1 }, { text: name, fg: colors[i] || theme.teal }]),
  ]
  const fitted = fitSpans(spans, width)
  const used = spansWidth(fitted)
  return used < width ? [...fitted, { text: " ".repeat(width - used), fg: theme.overlay1 }] : fitted
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
}) {
  const widest = createMemo(longest)
  const layout = createMemo(() => tableLayout(props.width, props.showAccount, props.showTags, widest()))
  const mark = (column: string) => props.sortMark?.(column) ?? ""
  const windowRows = createMemo(() => props.rows.slice(props.top, props.top + props.visible))
  return (
    <>
      <text fg={theme.subtext0}>
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
          {layout().showTags ? " ".repeat(columns.gap) + fit("Tags", layout().tags) : ""}
        </b>
      </text>
      <Show when={props.rows.length} fallback={<text fg={theme.overlay1}>{props.empty}</text>}>
        <box flexGrow={1} flexDirection="column">
          {/* Index keeps each screen row and updates it in place: a filter
              that changes every row would otherwise rebuild them all. */}
          <Index each={windowRows()}>
            {(r, i) => {
              const absIndex = () => props.top + i
              const isCursor = () => props.cursor === absIndex()
              const selected = () => !!props.selectedIds?.[r().id]
              const hl = () => !!props.highlighted?.[r().id]
              // OpenTUI cannot repaint a previous cell to transparency: it must
              // receive the table canvas colour when a row loses its state bg.
              // This is visually identical to the unstyled table background.
              const look = createMemo(() => rowAppearance(selected(), hl(), isCursor()))
              const rowBg = () => look().bg ?? theme.canvas
              const fg = (column: string) => look().fg ?? column
              // A near miss reads quieter than a match, unless cursor, selection or range colour it.
              const near = () => !!props.nearMiss?.(r().id)
              const faint = (column: string) => look().fg ?? (near() ? theme.overlay1 : column)
              // Up holds (pending) render italic, with a clock, until they settle.
              const held = () => r().status === "HELD"
              const tags = createMemo(() => {
                const candidate = props.tagCandidate?.(r().id)
                return candidate ? formatTagCandidate(candidate, r().tagNames, r().tagColors, layout().tags) : formatTags(r().tagNames, r().tagColors, layout().tags)
              })
              const category = createMemo(() => props.suggestions
                ? formatSuggestion(props.suggestions[r().id], layout().category)
                : withAskScore(formatCategory(r().categoryId, r().categoryName, r().categoryColor, layout().category), props.askScore?.(r().id), layout().category))
              const strong = () => look().bold
              return (
                <text width="100%" bg={rowBg()}>
                  <S fg={fg(theme.accent)} bg={rowBg()} bold={strong()}>
                    {isCursor() ? ">" : selected() ? "*" : near() ? "≈" : " "}
                  </S>
                  <S fg={faint(theme.mutedText)} bg={rowBg()} bold={strong()}>
                    {fmtDate(r().dateISO).padEnd(columns.date)}
                  </S>
                  <S fg={fg(theme.text)} bg={rowBg()} bold={strong()}>
                    {" ".repeat(columns.gap)}
                  </S>
                  <S fg={faint(amountColor(r().amount))} bg={rowBg()} bold={strong()} italic={held()}>
                    {formatMoney(r().amount).padEnd(columns.amount - 2)}
                  </S>
                  <S fg={fg(theme.overlay1)} bg={rowBg()}>
                    {held() ? `${pendingMark()} ` : "  "}
                  </S>
                  <S fg={fg(theme.text)} bg={rowBg()} bold={strong()}>
                    {" ".repeat(columns.gap)}
                  </S>
                  <S fg={faint(theme.brightText)} bg={rowBg()} bold={strong()} italic={held()}>
                    {fit(r().description, layout().description)}
                  </S>
                  <S fg={fg(theme.dimText)} bg={rowBg()} bold={strong()}>
                    {layout().showAccount ? " ".repeat(columns.gap) + fit(r().accountName, columns.account) : ""}
                  </S>
                  <S fg={fg(theme.text)} bg={rowBg()} bold={strong()}>
                    {" ".repeat(columns.gap)}
                  </S>
                  <S fg={fg(category().markerColor)} bg={rowBg()} bold={strong() && (!category().muted || !!look().fg)}>
                    {category().marker}
                  </S>
                  <S
                    fg={fg(category().textColor)}
                    bg={rowBg()}
                    bold={strong() && (!category().muted || !!look().fg)}
                    dim={category().muted && !look().fg}
                    italic={category().italic}
                  >
                    {category().text}
                  </S>
                  <S fg={fg(category().noteColor ?? theme.overlay1)} bg={rowBg()}>{category().note ?? ""}</S>
                  <Show when={layout().showTags}>
                    <S fg={fg(theme.text)} bg={rowBg()} bold={strong()}>
                      {" ".repeat(columns.gap)}
                    </S>
                    <Index each={tags()}>{(span) => <S fg={fg(span().fg)} bg={rowBg()} bold={strong()}>{span().text}</S>}</Index>
                  </Show>
                </text>
              )
            }}
          </Index>
        </box>
      </Show>
    </>
  )
}
