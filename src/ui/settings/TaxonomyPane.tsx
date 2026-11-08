import { armedFor } from "../../state/armed"
import { For, Show, createEffect, createMemo } from "solid-js"
import { SectionCard } from "../primitives/SectionCard"
import { SETTINGS_SECTION_LABELS, ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { ink, theme } from "../../theme"
import { fit, truncate } from "../text"
import type { Category, Tag } from "../../domain/types"
import { scopeText } from "../../domain/tagScope"
import { categoryMark } from "../icons"
import { ListRow } from "../primitives/ListRow"
import type { Span } from "../primitives/spans"
import { categoryRows, originCounts, originOf, type CategoryRow } from "../../state/taxonomyRows"
import { onSettings, Line, heading, COLUMN_GAP } from "./SettingsPanes"

/** A tag's scope in words: "in Holidays & Travel", "in Cafes, Takeaway",
 * with "· about" when it says what it is for. */
function tagNote(tag: Tag, categories: Category[]): string {
  const scope = scopeText(tag, categories)
  return [scope ? `in ${scope}` : "", tag.about ? "about" : ""].filter(Boolean).join(" · ")
}

/** What a category row says beside its name: a group's size, then what
 * kind of money it holds; a subcategory only what sets it apart. */
function categoryNote(row: CategoryRow, parentOrigin: "jaskmoney" | "up"): string {
  const c = row.category
  if (row.depth === 1) return parentOrigin === "up" && originOf(c) === "jaskmoney" ? "yours" : ""
  const kind = c.isDefault ? "default" : c.income ? "income" : c.notSpending ? "not spending" : ""
  return [row.children ? `${row.children} ${row.children === 1 ? "subcategory" : "subcategories"}` : "", kind].filter(Boolean).join(" · ")
}

type TaxonomyLine =
  | { kind: "heading"; spans: Span[] }
  | { kind: "blank" }
  | { kind: "empty"; text: string; list: "categories" | "tags" }
  | { kind: "category"; row: CategoryRow; index: number }
  | { kind: "tag"; tag: Tag; index: number }

/** Taxonomy's two blocks of lines: the categories (Jaskmoney's, then
 * Up's, each under its heading, a blank between) and the tags. */
function taxonomyBlocks(categories: Category[], tags: Tag[], open: readonly number[], active: boolean): { categories: TaxonomyLine[]; tags: TaxonomyLine[] } {
  const rows = categoryRows(categories, open)
  const counts = originCounts(categories)
  const out: TaxonomyLine[] = []
  const blocks = (["jaskmoney", "up"] as const).filter((origin) => rows.some((r) => r.origin === origin))
  for (const origin of blocks) {
    if (out.length) out.push({ kind: "blank" })
    const label = blocks.length === 1 ? "Categories" : origin === "up" ? "Up categories" : "Jaskmoney categories"
    out.push({ kind: "heading", spans: heading(label, blocks.length === 1 ? categories.length : counts[origin]) })
    rows.forEach((row, index) => { if (row.origin === origin) out.push({ kind: "category", row, index }) })
  }
  if (!blocks.length) out.push({ kind: "heading", spans: heading("Categories", 0) }, { kind: "empty", text: "No categories. Press a to add.", list: "categories" })
  const tagLines: TaxonomyLine[] = [{ kind: "heading", spans: heading("Tags", tags.length) }]
  if (tags.length) tags.forEach((tag, index) => tagLines.push({ kind: "tag", tag, index }))
  else tagLines.push({ kind: "empty", text: active ? "No tags. Press a to add." : "No tags yet.", list: "tags" })
  return { categories: out, tags: tagLines }
}

/** Taxonomy's columns: Categories beside Tags when the pane is wide
 * enough (j runs down the first, then the second), else one column with
 * the tags under the categories. */
function taxonomyColumns(width: number, active: boolean): TaxonomyLine[][] {
  const blocks = taxonomyBlocks(data.state.categories, data.state.tags, ui.state.taxonomyOpen, active)
  return width - 2 >= TAXONOMY_TWO_COLUMNS ? [blocks.categories, blocks.tags] : [[...blocks.categories, { kind: "blank" }, ...blocks.tags]]
}
/** The inner width (borders off) from which Taxonomy has two columns. */
const TAXONOMY_TWO_COLUMNS = 90

/** Taxonomy's height: its longest column and borders, up to `room` (then it scrolls), at least 8. */
export const taxonomyHeight = (width: number, room: number) =>
  Math.max(8, Math.min(room, Math.max(...taxonomyColumns(width, false).map((lines) => lines.length)) + 2))

/** Taxonomy: Jaskmoney's categories, then Up's (groups closed until
 * opened), and the tags; each column a window that follows the cursor. */
export function TaxonomyPane(props: { focused: boolean; width: number; height: number }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "taxonomy"
  const categories = () => data.state.categories
  const rows = createMemo(() => categoryRows(categories(), ui.state.taxonomyOpen))
  const columns = createMemo(() => taxonomyColumns(props.width, active()))
  const visible = () => Math.max(3, props.height - 2)
  createEffect(() => { if (ui.state.taxonomyVisible !== visible()) ui.setState({ taxonomyVisible: visible() }) })
  // Keep the cursors on a row as rows open, close and go.
  createEffect(() => {
    const last = Math.max(0, rows().length - 1)
    if (ui.state.categoryCursor > last) ui.setState({ categoryCursor: last })
    const tagLast = Math.max(0, data.state.tags.length - 1)
    if (ui.state.tagCursor > tagLast) ui.setState({ tagCursor: tagLast })
  })
  const isCursor = (line: TaxonomyLine) => active() && (
    line.kind === "category" ? ui.state.taxonomyList === "categories" && line.index === ui.state.categoryCursor
      : line.kind === "tag" ? ui.state.taxonomyList === "tags" && line.index === ui.state.tagCursor
        : line.kind === "empty" && ui.state.taxonomyList === line.list)
  // The column widths: Categories takes three fifths; the rest Tags.
  const inner = () => props.width - 2
  const widths = () => columns().length === 1 ? [inner()] : (() => { const first = Math.floor((inner() - COLUMN_GAP) * 0.6); return [first, inner() - COLUMN_GAP - first] })()
  // Each column's window moves only when the cursor would leave it; at the
  // top it shows the first heading.
  const tops = [0, 1].map((c) => createMemo<number>((prev) => {
    const lines = columns()[c] ?? []
    if (lines.length <= visible()) return 0
    const at = lines.findIndex(isCursor)
    let next = Math.min(prev, lines.length - visible())
    if (at >= 0 && at < next + 1) next = Math.max(0, at - 1)
    if (at >= 0 && at >= next + visible() - 1) next = Math.min(lines.length - visible(), at - visible() + 2)
    return next
  }, 0))
  const top = (c: number) => tops[c]?.() ?? 0
  const note = (line: TaxonomyLine) => line.kind === "category"
    ? categoryNote(line.row, line.row.depth === 1 ? originOf(categories().find((c) => c.id === line.row.category.parentId) ?? line.row.category) : line.row.origin)
    : line.kind === "tag" ? tagNote(line.tag, categories()) : ""
  const select = (line: TaxonomyLine) => onSettings(() => {
    if (line.kind === "category") {
      // A click on the row at the cursor opens or closes its group.
      if (isCursor(line) && line.row.children) {
        const open = ui.state.taxonomyOpen.filter((id) => id !== line.row.category.id)
        ui.setState({ taxonomyOpen: line.row.open ? open : [...open, line.row.category.id] })
        return
      }
      ui.activateSettings("taxonomy", "categories")
      ui.setState({ categoryCursor: line.index })
    } else if (line.kind === "tag") {
      ui.activateSettings("taxonomy", "tags")
      ui.setState({ tagCursor: line.index })
    } else ui.activateSettings("taxonomy", line.kind === "empty" ? line.list : ui.state.taxonomyList)
  })
  const more = (): Span[] | undefined => {
    const above = columns().some((_, c) => top(c) > 0), below = columns().some((lines, c) => top(c) + visible() < lines.length)
    return above || below ? [{ text: `${above ? "↑" : ""}${below ? "↓" : ""} more`, fg: ink.note }] : undefined
  }
  const pane: TaxonomyView = { columns, widths, inner, top, visible, isCursor, note, select }
  return <SectionCard inset title={SETTINGS_SECTION_LABELS.taxonomy} focused={props.focused} active={active()} height={props.height} width={props.width} bottomSpans={more()}>
    <box flexDirection="row" gap={COLUMN_GAP} width="100%" flexGrow={1}>
      <TaxonomyColumn index={0} pane={pane} />
      <Show when={columns().length > 1}><TaxonomyColumn index={1} pane={pane} /></Show>
    </box>
  </SectionCard>
}

/** What a Taxonomy column reads from its pane. */
interface TaxonomyView {
  columns: () => TaxonomyLine[][]
  widths: () => number[]
  inner: () => number
  top: (c: number) => number
  visible: () => number
  isCursor: (line: TaxonomyLine) => boolean
  note: (line: TaxonomyLine) => string
  select: (line: TaxonomyLine) => ReturnType<typeof onSettings>
}

/** One of Taxonomy's columns: the window of its lines at its top. */
function TaxonomyColumn(col: { index: number; pane: TaxonomyView }) {
  const { columns, widths, inner, top, visible, isCursor, note, select } = col.pane
  const lines = () => columns()[col.index] ?? []
  const width = () => (widths()[col.index] ?? inner()) - 2
  // Names in a column as wide as the longest shown, the notes just after.
  const NAME = createMemo(() => Math.min(width() - 8, Math.max(12, ...lines().map((line) =>
    line.kind === "category" ? (line.row.depth ? 6 : 4) + line.row.category.name.length : line.kind === "tag" ? 2 + line.tag.name.length : 0))))
  const NOTE = createMemo(() => Math.max(0, Math.min(width() - NAME() - 2, Math.max(0, ...lines().map((line) => note(line).length)))))
  return <box width={widths()[col.index]} flexShrink={0} flexDirection="column">
    <For each={lines().slice(top(col.index), top(col.index) + visible())}>{(line) => {
      const cursor = () => isCursor(line)
      if (line.kind === "heading") return <Line spans={line.spans} />
      if (line.kind === "blank") return <Line spans={[]} />
      if (line.kind === "empty") return <ListRow cursor={cursor()} bg={theme.canvas} onMouseDown={select(line)} spans={[{ text: line.text, fg: ink.note }]} />
      const text = (): Span[] => {
        const n = note(line)
        const tail: Span[] = n && NOTE() ? [{ text: `  ${truncate(n, NOTE())}`, fg: ink.note }] : []
        if (line.kind === "tag") return [
          { text: "● ", fg: line.tag.color },
          { text: fit(line.tag.name, NAME() - 2), fg: ink.figure, bold: cursor() },
          ...tail,
        ]
        const row = line.row
        const lead = row.depth === 1 ? "    " : row.children ? (row.open ? "▾ " : "▸ ") : "  "
        return [
          { text: lead, fg: ink.label },
          { text: `${categoryMark(row.category.id)} `, fg: row.category.color },
          { text: fit(row.category.name, NAME() - lead.length - 2), fg: row.depth === 1 ? ink.label : ink.figure, bold: cursor() },
          ...tail,
        ]
      }
      const armed = () => line.kind === "tag" ? armedFor(ui.state.armed, "tag", line.tag.id) : armedFor(ui.state.armed, "category", line.row.category.id)
      return <ListRow cursor={cursor()} bg={theme.canvas} armed={armed()} onMouseDown={select(line)} spans={text()} />
    }}</For>
  </box>
}
