import { APPEARANCE_ROWS, appearanceRow } from "../../state/appearanceRows"
import { onPointer } from "../../app/pointer"
import { armedFor, isArmed } from "../../state/armed"
import { DATABASE_ROWS, IMPORT_HISTORY_ROWS, databaseRow } from "../../state/databaseRows"
import { AI_ROWS } from "../../app/apiKeys"
import { USES } from "../../ai/catalog"
import { syncAgo } from "../../app/sync"
import { AI_NAMES, AI_USES, aiActionHint, aiActions, aiConnection, aiContext, aiRow, aiStatus, useModel } from "../../state/aiDialog"
import { secretDisplay } from "../../state/settingsForm"
import { executorRow } from "../../state/executorDialog"
import { executorSignedIn } from "../../ai/executor"
import { SignInBody } from "../primitives/SignInBody"
import { spinnerFrame } from "../primitives/Spinner"
import { swatches, themeDef } from "./ThemePicker"
import { SettingsBackdrop } from "./Backdrop"
import { CardColumn, CardSides, actionLine, blank, labelled, noteLines, numbered, usesLines, wrapped, type CardLine } from "../primitives/cardLines"
import { AI_USES_TEXT, UP_TOKEN_STEPS, UP_USES, type IntegrationUse } from "../../state/integrationUses"
import { For, Show, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import type { MouseEvent, ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { TextInput } from "../primitives/TextInput"
import type { ScopeId, SectionId, SettingsSection, UiState } from "../../state/uiStore"
import { SETTINGS_SECTION_LABELS, ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { parseFilterStrict } from "../../domain/filter"
import { ink, theme, tone } from "../../theme"
import { count, fit, truncate } from "../text"
import { formatMoney } from "../../domain/dashboard"
import { accountRole, type Category, type Tag } from "../../domain/types"
import { scopeText } from "../../domain/tagScope"
import { Modal } from "../primitives/Modal"
import { categoryMark, settingMark, type SettingIcon } from "../icons"
import { regionRef } from "../regions"
import { Form } from "../primitives/Form"
import { ListPicker } from "../primitives/ListPicker"
import { ListRow, centredTop, windowLabel } from "../primitives/ListRow"
import type { Span } from "../primitives/spans"
import { categoryRows, originCounts, originOf, type CategoryRow } from "../../state/taxonomyRows"
import { EDITOR_TITLE, editorFields, editorNote, editorWidth, pickerItems, type FormField } from "../../state/settingsForm"

/**
 * Settings' panes share one layout (SectionCard `inset`): every line is a
 * ListRow, so all text starts one cell in from the border and a cursor's
 * wash runs border to border; subheadings are ink.heading. Every pane takes
 * focus: a click on it activates it, a click on a row also puts the cursor
 * there.
 */

/** A row's text width in a pane `width` columns wide: the borders, the
 * row's inset and a cell before the right border. */
const rowWidth = (width: number) => Math.max(10, width - 4)

/** Where a click on a pane counts: the page, or a pane of it (not under a dialog). */
const SETTINGS_SCOPES = new Set<ScopeId>(["bar", "settings", "settings.taxonomy", "settings.rules", "settings.filters", "settings.up", "settings.ai", "settings.appearance", "settings.database"])
const onSettings = (action: (event: MouseEvent) => void) => onPointer((scope) => SETTINGS_SCOPES.has(scope), action)

/** A line of a pane that isn't a cursor row: a subheading, a note, a blank. */
function Line(props: { spans: Span[] }) {
  return <ListRow cursor={false} bg={theme.canvas} spans={props.spans} />
}
const heading = (label: string, n?: number, note = ""): Span[] => [
  { text: label, fg: ink.heading, bold: true },
  ...(n != null ? [{ text: ` ${n}${note}`, fg: ink.note }] : []),
]

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
/** Between Taxonomy's columns. */
const COLUMN_GAP = 2

/** Taxonomy's height: its longest column and borders, up to `room` (then it scrolls), at least 8. */
const taxonomyHeight = (width: number, room: number) =>
  Math.max(8, Math.min(room, Math.max(...taxonomyColumns(width, false).map((lines) => lines.length)) + 2))

/** Taxonomy: Jaskmoney's categories, then Up's (groups closed until
 * opened), and the tags; each column a window that follows the cursor. */
function TaxonomyPane(props: { focused: boolean; width: number; height: number }) {
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
  const Column = (col: { index: number }) => {
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
  return <SectionCard inset title={SETTINGS_SECTION_LABELS.taxonomy} focused={props.focused} active={active()} height={props.height} width={props.width} bottomSpans={more()}>
    <box flexDirection="row" gap={COLUMN_GAP} width="100%" flexGrow={1}>
      <Column index={0} />
      <Show when={columns().length > 1}><Column index={1} /></Show>
    </box>
  </SectionCard>
}

/** A row's state: what colours its mark. */
type RowState = "good" | "caution" | "bad" | "off" | "plain"
const STATE_INK: Record<RowState, () => string> = { good: () => tone.good, caution: () => tone.caution, bad: () => tone.bad, off: () => ink.faint, plain: () => ink.label }
/** A row's mark, in its state's colour: its icon with icons on, else a dot
 * (hollow when off; `dot` for a row with no state, e.g. "›" for an action).
 * `spin`: a spinner frame in its place while something runs. */
const mark = (icon: SettingIcon, state: RowState, spin = "", dot?: string): Span =>
  ({ text: `${spin || settingMark(icon, dot ?? (state === "off" ? "○" : "●"))} `, fg: spin ? ink.figure : STATE_INK[state]() })
/** A row's icon as decoration (icons on), or nothing. */
const decoration = (icon: SettingIcon, fg = ink.label): Span[] => { const glyph = settingMark(icon); return glyph ? [{ text: `${glyph} `, fg }] : [] }
/** A setting's value: a toggle as a dot and its words, a choice with a dot
 * per option (the set one filled). */
function settingValue(view: { value: string; on?: boolean; choice?: { index: number; count: number } }, fg = ink.figure): Span[] {
  if (view.on != null) return [{ text: view.on ? "● " : "○ ", fg: view.on ? ink.figure : ink.faint }, { text: view.value, fg: view.on ? fg : ink.label }]
  if (!view.choice) return [{ text: view.value, fg }]
  return [{ text: view.value, fg }, { text: "  ", fg }, ...Array.from({ length: view.choice.count }, (_, i): Span => ({ text: i === view.choice!.index ? "●" : "○", fg: i === view.choice!.index ? ink.figure : ink.faint }))]
}

/** Rules & Filters' height: borders, two headings, a blank between, and
 * each list's rows (one line when empty). */
const rulesHeight = () => 2 + 1 + Math.max(1, data.state.rules.length) + 1 + 1 + Math.max(1, data.state.savedFilters.length)

/** Rules and the saved filters they match, in one card: Rules (ordered,
 * last match wins) above Saved filters. Each list is its own section (its
 * keys and cursor); j/k run on from one into the other. A rule's mark says
 * whether it runs: on, off, or its filter broken or gone. */
function RulesPane(props: { focused: boolean; width: number }) {
  const rulesActive = () => ui.state.settingsActive && ui.state.settingsSection === "rules"
  const filtersActive = () => ui.state.settingsActive && ui.state.settingsSection === "filters"
  const rules = () => data.state.rules
  const filters = () => data.state.savedFilters
  const nameWidth = () => Math.min(28, Math.floor(rowWidth(props.width) * 0.32))
  const setWidth = () => Math.min(30, Math.floor(rowWidth(props.width) * 0.3))
  const idWidth = () => Math.min(22, Math.max(...filters().map((f) => f.id.length + 7), 12))
  const pickRule = (i: number) => onSettings(() => { ui.activateSettings("rules"); ui.setState({ ruleCursor: i }) })
  const pickFilter = (i: number) => onSettings(() => { ui.activateSettings("filters"); ui.setState({ filterCursor: i }) })
  return <SectionCard inset title="Rules & Filters" focused={props.focused} active={rulesActive() || filtersActive()} height={rulesHeight()} width={props.width}>
    <Line spans={heading("Rules", rules().length, rules().length > 1 ? " · last match wins" : "")} />
    <Show when={rules().length} fallback={<ListRow cursor={rulesActive()} bg={theme.canvas} onMouseDown={pickRule(0)} spans={[{ text: rulesActive() ? "No rules. Press a to add." : "No rules yet.", fg: ink.note }]} />}>
      <For each={rules()}>{(rule, i) => {
        const cat = () => data.state.categories.find((c) => c.id === rule.setCategoryId)?.name
        const tags = () => rule.addTagIds.map((id) => data.state.tags.find((t) => t.id === id)?.name).filter(Boolean).map((name) => `+${name}`).join(" ")
        const filter = () => filters().find((filter) => filter.id === rule.savedFilterId)
        const healthy = createMemo(() => { const parsed = parseFilterStrict(filter()?.expr ?? ""); return !!parsed.node && !parsed.error })
        const on = () => rule.enabled
        const matches = () => !filter() ? `missing filter ${rule.savedFilterId}` : healthy() ? `filter:${rule.savedFilterId}` : `broken filter:${rule.savedFilterId}`
        const sets = () => [cat() ? `→ ${cat()}` : "", tags()].filter(Boolean).join(" ") || "→ nothing"
        return <ListRow id={`settings-rule-${i()}`} cursor={rulesActive() && ui.state.ruleCursor === i()} bg={theme.canvas} armed={armedFor(ui.state.armed, "rule", rule.id)} onMouseDown={pickRule(i())} spans={[
          mark("rule", !on() ? "off" : filter() && healthy() ? "good" : "bad"),
          { text: `${String(i() + 1).padStart(2)}  `, fg: ink.note },
          { text: fit(`${rule.name}${on() ? "" : " (off)"}`, nameWidth()), fg: on() ? ink.figure : ink.faint },
          { text: `  ${fit(sets(), setWidth())}`, fg: on() ? ink.label : ink.faint },
          { text: `  ${matches()}`, fg: !on() ? ink.faint : filter() && healthy() ? ink.label : tone.bad },
        ]} />
      }}</For>
    </Show>
    <Line spans={[]} />
    <Line spans={heading("Saved filters", filters().length)} />
    <Show when={filters().length} fallback={<ListRow cursor={filtersActive()} bg={theme.canvas} onMouseDown={pickFilter(0)} spans={[{ text: filtersActive() ? "No saved filters. Press a to add." : "No saved filters yet.", fg: ink.note }]} />}>
      <For each={filters()}>{(filter, i) => (
        <ListRow id={`settings-filter-${i()}`} cursor={filtersActive() && ui.state.filterCursor === i()} bg={theme.canvas} armed={armedFor(ui.state.armed, "filter", filter.id)} onMouseDown={pickFilter(i())} spans={[
          ...decoration("filter"),
          { text: fit(filter.name, nameWidth() + 4), fg: ink.figure },
          { text: `  ${fit(`filter:${filter.id}`, idWidth())}`, fg: ink.label },
          { text: `  ${filter.expr}`, fg: ink.label },
        ]} />
      )}</For>
    </Show>
  </SectionCard>
}

/** Appearance's width beside Database & Import: its labels and longest values. */
const APPEARANCE_WIDTH = 40

/** Appearance: each preference with its icon; the theme with its colours,
 * a toggle as on or off, a choice with which of its options is set. */
function AppearancePane(props: { focused: boolean; width: number; height?: number }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "appearance"
  const ctx = () => ({ ...data.state.uiPrefs, icons: data.state.icons })
  return <SectionCard inset title={SETTINGS_SECTION_LABELS.appearance} focused={props.focused} active={active()} height={props.height ?? APPEARANCE_ROWS.length + 2} width={props.width}>
    <For each={APPEARANCE_ROWS}>{(row, i) => {
      const view = () => appearanceRow(row, ctx())
      return <ListRow id={`settings-appearance-${i()}`} cursor={active() && ui.state.appearanceCursor === i()} bg={theme.canvas}
        onMouseDown={onSettings(() => { ui.activateSettings("appearance"); ui.setState({ appearanceCursor: i() }) })} spans={[
          ...decoration(row),
          { text: fit(view().label, 17), fg: ink.label },
          ...settingValue(view()),
          ...(row === "theme" ? [{ text: "  ", fg: ink.note }, ...swatches(themeDef(data.state.uiPrefs.theme), true)] : []),
        ]} />
    }}</For>
  </SectionCard>
}

/** The database: where it is and what it holds, then its settings and
 * actions as rows (always shown; the cursor only while active). */
function DatabasePane(props: { focused: boolean; width: number; height?: number }) {
  const info = () => data.state.dbInfo
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "database"
  const where = () => {
    const path = data.state.dbPath
    const home = process.env.HOME
    return `${home && path.startsWith(home) ? `~${path.slice(home.length)}` : path} · schema v${info()?.schemaVersion ?? "—"}`
  }
  const n = (value: number | undefined, one: string, many = `${one}s`) => `${(value ?? 0).toLocaleString("en-AU")} ${value === 1 ? one : many}`
  const holds = () => [
    n(info()?.transactionCount, "transaction"), n(info()?.accountCount, "account"),
    n(info()?.categoryCount, "category", "categories"), n(info()?.tagCount, "tag"), n(info()?.ruleCount, "rule"),
  ].join(" · ")
  const ctx = () => ({ weekStart: data.state.weekStart, profiles: data.state.importProfiles.length, demo: data.state.demo, imports: data.state.imports.length })
  // The counts sit under the path, past the database's icon.
  const indent = () => decoration("database").length ? "  " : ""
  return <SectionCard inset title={SETTINGS_SECTION_LABELS.database} focused={props.focused} active={active()} height={props.height ?? DATABASE_ROWS.length + 5} width={props.width}>
    <Line spans={[...decoration("database", ink.figure), { text: truncate(where(), rowWidth(props.width) - indent().length), fg: ink.label }]} />
    <Line spans={[{ text: indent() + truncate(holds(), rowWidth(props.width) - indent().length), fg: ink.note }]} />
    <Line spans={[]} />
    <For each={DATABASE_ROWS}>{(row, i) => {
      const view = () => databaseRow(row, ctx())
      return <ListRow id={`settings-database-${i()}`} cursor={active() && ui.state.databaseCursor === i()} bg={theme.canvas} armed={row === "clearData" ? armedFor(ui.state.armed, "clearData", 0) : undefined}
        onMouseDown={onSettings(() => { ui.activateSettings("database"); ui.setState({ databaseCursor: i() }) })} spans={[
          ...decoration(row, view().danger ? tone.bad : ink.label),
          { text: fit(view().label, 20), fg: view().danger ? tone.bad : ink.label },
          ...(view().value != null ? settingValue(view() as { value: string }, view().danger ? ink.note : ink.figure) : []),
        ]} />
    }}</For>
  </SectionCard>
}

/** Up Bank: the token, sync and which accounts are linked; enter on a row
 * opens it (the token's dialog, a sync now, the accounts dialog). The token
 * itself is never rendered. Each row's mark says how it stands; Sync's
 * spins while a sync runs. */
/** Up Bank's height: borders and its rows, and the last sync's error. */
const upHeight = () => 6 + (data.state.dbInfo?.upLastError ? 1 : 0)

function UpPane(props: { focused: boolean; width: number; height?: number }) {
  const info = () => data.state.dbInfo
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "up"
  const connection = () => aiConnection("up", aiContext(data))
  const accounts = () => data.state.syncAccounts
  const off = () => accounts().filter((a) => !a.syncEnabled)
  const spin = spinnerFrame(() => data.state.upSyncing)
  const synced = () => data.state.upSyncing ? "syncing…" : (() => { const ago = syncAgo(info()?.upLastSyncedAt ?? null, Date.now()); return ago ? `synced ${ago}` : "not synced yet" })()
  const syncState = (): RowState => !connection() ? "off" : info()?.upLastError ? "bad" : info()?.upLastSyncedAt ? "good" : "off"
  // How many sync; which are off when that fits, else just how many.
  const linked = () => {
    if (!accounts().length) return "none yet · they appear after a sync"
    const syncing = `${accounts().length - off().length} of ${accounts().length} syncing`
    const named = off().length ? `${syncing} · ${off().map((a) => a.name).join(", ")} off` : syncing
    return named.length <= rowWidth(props.width) - 13 ? named : syncing
  }
  const row = (i: number, lead: Span, label: string, value: string, fg: string) =>
    <ListRow cursor={active() && ui.state.upCursor === i} bg={theme.canvas} onMouseDown={onSettings(() => { ui.activateSettings("up"); ui.setState({ upCursor: i }) })} spans={[lead, { text: fit(label, 11), fg: ink.label }, { text: value, fg }]} />
  return <SectionCard inset title={SETTINGS_SECTION_LABELS.up} focused={props.focused} active={active()} height={props.height ?? upHeight()} width={props.width}>
    {row(0, mark("token", connection() ? "good" : "off"), "Token", connection() ? connection()!.short : "not set · enter to add", connection() ? ink.figure : ink.faint)}
    {row(1, mark("sync", syncState(), spin()), "Sync", connection() ? `${synced()} · on start and every 5 min` : "needs the token", ink.figure)}
    <Show when={info()?.upLastError}>{(error: () => string) => <Line spans={[{ text: " ".repeat(13), fg: ink.label }, { text: error(), fg: tone.bad }]} />}</Show>
    {row(2, mark("accounts", !accounts().length ? "off" : off().length ? "caution" : "good"), "Accounts", linked(), ink.figure)}
    {row(3, mark("setup", "plain", "", "›"), "Setup", "first-time setup: Up, AI, email", ink.note)}
  </SectionCard>
}

/** Which Up accounts sync: name, kind, on or off. New accounts, savers
 * included, sync from the start. */
export function UpAccountsDialog() {
  return (
    <Show when={ui.state.upAccounts}>
      {(d: () => NonNullable<UiState["upAccounts"]>) => (
        <Modal title="Up accounts" subtitle="which accounts sync" width={52} hints="j/k move · enter on/off · esc close">
          <Show when={data.state.syncAccounts.length} fallback={<text fg={ink.note}>No accounts yet: they appear after a sync.</text>}>
            <For each={data.state.syncAccounts}>{(account, i) => {
              const on = () => account.syncEnabled
              return <ListRow cursor={d().cursor === i()} bg={theme.mantle} armed={armedFor(ui.state.armed, "desyncAccount", account.id)} spans={[
                { text: fit(account.name, 24), fg: on() ? ink.figure : ink.faint },
                { text: fit(accountRole(account) === "saver" ? "saver" : "spending", 10), fg: ink.label },
                { text: on() ? "● syncing" : "○ off", fg: on() ? ink.label : ink.faint },
              ]} />
            }}</For>
          </Show>
          <text> </text>
          <text fg={ink.note} wrapMode="word">Switching an account off removes its transactions here (enter twice); on brings them back at the next sync.</text>
        </Modal>
      )}
    </Show>
  )
}

/** AI models' height: two columns (Models and Sources beside Uses) from
 * AI_TWO_COLUMNS, else stacked, a blank between the inputs and the uses. */
const AI_TWO_COLUMNS = 84
const aiHeight = (width: number) => {
  // Each block is its heading and rows: Models, Sources (Executor), Uses.
  const models = 1 + AI_ROWS.length, sources = 1 + 1, uses = 1 + AI_USES.length
  return 2 + (width - 2 >= AI_TWO_COLUMNS ? Math.max(models + sources, uses) : models + sources + 1 + uses)
}

/** Settings › AI models: what goes in (the models and how each is
 * connected, the sources: Executor for Gmail and more), then what comes
 * out (the uses and the model doing each); enter opens any one's dialog.
 * j runs in that order (aiPaneRows): down the first column, then the second. */
function AiPane(props: { focused: boolean; width: number }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "ai"
  const ctx = () => aiContext(data)
  const models = () => AI_ROWS.map((row) => aiRow(row, ctx()))
  const uses = () => AI_USES.map((use) => ({ name: USES[use].name, model: useModel(use, ctx()) }))
  const executor = () => executorRow(ui.state.executorStatus, executorSignedIn())
  const at = (i: number) => active() && ui.state.aiCursor === i
  const pick = (i: number) => onSettings(() => { ui.activateSettings("ai"); ui.setState({ aiCursor: i }) })
  const two = () => props.width - 2 >= AI_TWO_COLUMNS
  // Two columns: the inputs and the uses half each.
  const firstWidth = () => two() ? Math.floor((props.width - 2 - COLUMN_GAP) / 2) : props.width - 2
  const secondWidth = () => two() ? props.width - 2 - COLUMN_GAP - firstWidth() : props.width - 2
  const valueWidth = (width: number) => Math.max(8, width - 2 - 15)
  const source = AI_ROWS.length
  const Inputs = () => <>
    <Line spans={heading("Models")} />
    <For each={models()}>{(row, i) => (
      <ListRow cursor={at(i())} bg={theme.canvas} onMouseDown={pick(i())} spans={[
        { text: row.connected ? "● " : "○ ", fg: row.connected ? tone.good : ink.faint },
        { text: fit(row.name, 13), fg: ink.figure },
        { text: fit(row.how, valueWidth(firstWidth())), fg: row.connected ? ink.label : ink.note },
      ]} />
    )}</For>
    <Line spans={heading("Sources")} />
    <ListRow cursor={at(source)} bg={theme.canvas} onMouseDown={pick(source)} spans={[
      { text: executor().connected ? "● " : "○ ", fg: executor().connected ? tone.good : ink.faint },
      { text: fit("Executor", 13), fg: ink.figure },
      { text: fit(executor().how, valueWidth(firstWidth())), fg: executor().connected ? ink.label : ink.note },
    ]} />
  </>
  const Uses = () => <>
    <Line spans={heading("Uses")} />
    <For each={uses()}>{(use, i) => (
      <ListRow cursor={at(source + 1 + i())} bg={theme.canvas} onMouseDown={pick(source + 1 + i())} spans={[
        { text: use.model.ready ? "● " : "○ ", fg: use.model.ready ? tone.ai : ink.faint },
        { text: fit(use.name, 13), fg: ink.figure },
        { text: fit(use.model.text, valueWidth(secondWidth())), fg: use.model.ready ? tone.ai : ink.faint },
      ]} />
    )}</For>
  </>
  return <SectionCard inset title={SETTINGS_SECTION_LABELS.ai} focused={props.focused} active={active()} height={aiHeight(props.width)} width={props.width}>
    <Show when={two()} fallback={<><Inputs /><Line spans={[]} /><Uses /></>}>
      <box flexDirection="row" gap={COLUMN_GAP} width="100%">
        <box width={firstWidth()} flexShrink={0} flexDirection="column"><Inputs /></box>
        <box width={secondWidth()} flexShrink={0} flexDirection="column"><Uses /></box>
      </box>
    </Show>
  </SectionCard>
}

/** What jaskmoney does with each row's integration (the setup's panels). */
const ROW_USES: Record<NonNullable<UiState["aiDialog"]>["row"], IntegrationUse> = {
  up: UP_USES, jev: AI_USES_TEXT.jev, openrouter: AI_USES_TEXT.openrouter, openai: AI_USES_TEXT.openai, workersAi: AI_USES_TEXT.clairic,
}

/** A dialog laid out as the setup's card: as wide as there's room for (to
 * 120), what to do beside what the integration does from 100 columns,
 * else the left side alone. Widths inside the dialog's border and padding. */
function useCardWidths() {
  const dims = useTerminalDimensions()
  const width = () => Math.max(40, Math.min(dims().width - 4, 120))
  const beside = () => width() >= 100
  const inner = () => width() - 4
  const left = () => (beside() ? Math.floor(inner() * 0.5) : inner())
  const right = () => (beside() ? inner() - left() - 3 : 0)
  return { width, beside, left, right }
}

/** One model's dialog (and Up Bank's token): how it's connected, the steps
 * to a token while there's none (Up), its actions; a field when typing a
 * key, account id or model; a browser sign-in in progress. Beside it, what
 * jaskmoney does with it, as the setup shows it. No part of a key is ever
 * shown: the core sends only where one comes from. */
export function AiDialog() {
  return (
    <Show when={ui.state.aiDialog}>
      {(d: () => NonNullable<UiState["aiDialog"]>) => {
        const ctx = () => aiContext(data)
        const card = useCardWidths()
        const actions = () => aiActions(d().row, ctx())
        const cursor = () => Math.min(d().cursor, actions().length - 1)
        const at = () => actions()[cursor()]
        const signIn = () => (ui.state.llmSignIn?.provider === d().row ? ui.state.llmSignIn : null)
        const fieldLabel = (action: string) => (action === "key" ? (d().row === "up" ? "Token" : d().row === "workersAi" ? "API token" : "API key") : action === "accountId" ? "Account ID" : "Model")
        const connected = () => !!aiConnection(d().row, ctx())
        const top = (): CardLine[] => [
          ...aiStatus(d().row, ctx()).flatMap((line) => labelled(line.label, line.value, card.left(), line.label === "Connection" ? (connected() ? tone.good : ink.faint) : line.label === "Model" ? ink.figure : ink.label)),
          // Up without a token: how to make one, as the setup says it.
          ...(d().row === "up" && !connected() && !signIn() ? [blank, ...numbered(UP_TOKEN_STEPS, card.left())] : []),
          blank,
        ]
        const choices = (): CardLine[] => [
          ...actions().map((action, i) => actionLine({
            at: i === cursor(), bg: theme.rowCursor,
            label: action.id === "remove" && i === cursor() && isArmed(ui.state.armed, "aiKey", d().row) ? "Press enter again to remove" : action.label,
            fg: action.id === "remove" ? tone.bad : undefined,
          })),
          ...(at() && aiActionHint(d().row, at()!.id, ctx()) ? [blank, ...wrapped(aiActionHint(d().row, at()!.id, ctx())!, card.left(), ink.note)] : []),
        ]
        const result = (): CardLine[] => (d().note ? [blank, ...noteLines(d().note!, card.left())] : [])
        return (
          <Modal title={AI_NAMES[d().row].name} subtitle={AI_NAMES[d().row].by} width={card.width()}
            hints={signIn() ? (signIn()!.paste ? "enter send · esc cancel" : "waiting for your browser · esc cancel") : d().field ? "enter save · esc back" : `paste ${d().row === "up" || d().row === "workersAi" ? "a token" : "a key"} · j/k move · enter do · esc close`}>
            <CardSides beside={card.beside()} leftWidth={card.left()} rightWidth={card.right()} panel={card.beside() ? usesLines(ROW_USES[d().row], card.right() - 3) : []} bg={theme.mantle}>
              <CardColumn lines={top()} width={card.left()} bg={theme.mantle} />
              <Show when={signIn()} fallback={
                <Show when={d().field} fallback={<CardColumn lines={choices()} width={card.left()} bg={theme.mantle} />}>
                  {(f: () => NonNullable<NonNullable<UiState["aiDialog"]>["field"]>) => (
                    <>
                      <text wrapMode="none">
                        <S fg={tone.key} bold>{" › "}</S>
                        <S fg={ink.label}>{fieldLabel(f().action).padEnd(12)}</S>
                        {f().action === "key"
                          ? <S fg={f().value ? ink.figure : ink.faint}>{secretDisplay(f().value)}</S>
                          : <TextInput field={{ value: f().value, caret: f().caret }} focused caretColor={ink.figure} />}
                      </text>
                      <text> </text>
                      <CardColumn lines={wrapped(aiActionHint(d().row, f().action, ctx()) ?? "", card.left(), ink.note)} width={card.left()} bg={theme.mantle} />
                    </>
                  )}
                </Show>
              }>
                {(flow: () => NonNullable<UiState["llmSignIn"]>) => <SignInBody flow={flow()} width={card.left()} />}
              </Show>
              <CardColumn lines={result()} width={card.left()} bg={theme.mantle} />
            </CardSides>
          </Modal>
        )
      }}
    </Show>
  )
}


/** Database & Import › Import history: every CSV import, newest first, a
 * window of IMPORT_HISTORY_ROWS at a time. */
function ImportHistoryDialog() {
  const when = (iso: string) => { const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) }
  const imports = () => data.state.imports
  const top = () => Math.min(ui.state.importHistory?.top ?? 0, Math.max(0, imports().length - IMPORT_HISTORY_ROWS))
  return (
    <Show when={ui.state.importHistory}>
      <Modal title="Import history" subtitle={count(imports().length, "import")} width={72} hints={imports().length > IMPORT_HISTORY_ROWS ? "j/k scroll · esc close" : "esc close"}>
        <Show when={imports().length} fallback={<text fg={ink.note}>No imports yet. Import a CSV from Database & Import.</text>}>
          <For each={imports().slice(top(), top() + IMPORT_HISTORY_ROWS)}>{(item) => (
            <ListRow cursor={false} bg={theme.mantle} spans={[
              { text: fit(item.filename, 34), fg: ink.figure },
              { text: count(item.rowCount, "row").padStart(10), fg: ink.note },
              { text: `  ${when(item.importedAt)}`, fg: ink.label },
            ]} />
          )}</For>
          <Show when={imports().length > IMPORT_HISTORY_ROWS}><text fg={ink.note}>{`─ ${windowLabel(top(), IMPORT_HISTORY_ROWS, imports().length)} ─`}</text></Show>
        </Show>
      </Modal>
    </Show>
  )
}

const PREVIEW_ROWS = 8

function ImportOverlay() {
  const stage = () => (ui.state.importWizard?.stage ?? "none")
  const previewRows = () => { const p = ui.state.importWizard!.preview; return p ? (ui.state.importWizard!.previewShowAll ? p.rows : p.rows.filter((row) => row.duplicate)) : [] }
  // The preview shows PREVIEW_ROWS rows at a time around the cursor.
  const previewTop = () => centredTop(ui.state.importWizard!.previewCursor, previewRows().length, PREVIEW_ROWS)
  const previewWindow = () => previewRows().slice(previewTop(), previewTop() + PREVIEW_ROWS)
  const profile = () => ui.state.importWizard!.profileDraft
  const profileFields = () => [
    ["ID", profile().id], ["Name", profile().name], ["Account", profile().account], ["Type", profile().accountType], ["Prefix", profile().importPrefix], ["Header", profile().hasHeader ? "yes" : "no"], ["Delimiter", profile().delimiter], ["Date column", String(profile().dateColumn)], ["Amount column", String(profile().amountColumn)], ["Description columns", profile().descriptionColumns.join(",")], ["Join description tail", profile().descriptionJoin ? "yes" : "no"], ["Amount strip", profile().amountStrip], ["Date order", profile().dateFormat],
  ]
  return <>
    <Show when={stage() === "files"}>
      <Modal title="Import CSV" hints="enter select · p path · esc cancel">
        <text fg={ink.label}>{ui.state.importWizard!.directory}</text>
        <Show when={ui.state.importWizard!.files.length} fallback={<text fg={ink.note}>No CSV files here. Press p to enter a path.</text>}>
          <For each={ui.state.importWizard!.files}>{(path, i) => (
            <ListRow cursor={i() === ui.state.importWizard!.cursor} bg={theme.mantle} spans={[{ text: path.split(/[\\/]/).pop() ?? path, fg: ink.figure }]} />
          )}</For>
        </Show>
      </Modal>
    </Show>
    <Show when={stage() === "path"}><Modal title="Import CSV path"><text fg={ink.figure}><TextInput field={{ value: ui.state.importWizard!.path, caret: ui.state.importWizard!.pathCaret }} focused /></text><text fg={ink.note}>Enter an absolute path or one relative to the listed folder.</text></Modal></Show>
    <Show when={stage() === "profile"}>
      <Modal title={ui.state.importWizard!.managing ? "Import profiles" : "Choose import profile"} hints="a new · e edit · del del delete · enter select · esc back">
        <Show when={data.state.importProfiles.length} fallback={<text fg={ink.note}>No profiles yet. Press a to map this CSV.</text>}>
          <For each={data.state.importProfiles}>{(item, i) => (
            <ListRow cursor={i() === ui.state.importWizard!.profileCursor} bg={theme.mantle} armed={armedFor(ui.state.armed, "profile", item.id)} spans={[
              { text: item.name, fg: ink.figure },
              { text: `  ${item.account} · ${item.importPrefix || "no prefix"}`, fg: ink.label },
            ]} />
          )}</For>
        </Show>
        <ListRow cursor={ui.state.importWizard!.profileCursor === data.state.importProfiles.length} bg={theme.mantle} spans={[{ text: "New mapped profile", fg: ink.label }]} />
      </Modal>
    </Show>
    <Show when={stage() === "profileEditor"}><Modal title="Map CSV profile" hints={`tab field · h/l choices · enter ${ui.state.importWizard!.path ? "save and scan" : "save"} · esc back`}><For each={profileFields()}>{(entry, i) => <text><S fg={ink.label} bold={i() === ui.state.importWizard!.profileField}>{i() === ui.state.importWizard!.profileField ? "> " : "  "}{entry[0]}: </S><TextInput field={{ value: entry[1] ?? "", caret: ui.state.importWizard!.profileCaret }} focused={i() === ui.state.importWizard!.profileField && ![3, 5, 10, 12].includes(i())} /></text>}</For></Modal></Show>
    <Show when={stage() === "preview" && ui.state.importWizard!.preview}>{(p: () => NonNullable<NonNullable<typeof ui.state.importWizard>["preview"]>) => (
      <Modal title="Import preview" hints="s skip duplicates · a force import · p all/dupes · r rules · esc cancel">
        <text fg={ink.label}>{p().filename} · {p().accountName} · {p().profile.name}</text>
        <text fg={ink.note}>Rows {p().rows.length} · <S fg={ink.note}>{p().newCount} new</S> · <S fg={tone.caution}>{p().duplicateCount} duplicates</S> · <S fg={p().errors.length ? tone.bad : ink.note}>{p().errors.length} errors</S></text>
        <Show when={p().errors.length}>
          <For each={p().errors.slice(0, 4)}>{(err) => <text fg={tone.bad}>{`line ${err.sourceLine}: ${err.message}`}</text>}</For>
          <text fg={tone.bad}>Import blocked until parsing errors are fixed.</text>
        </Show>
        <text fg={ink.label}>{ui.state.importWizard!.previewShowAll ? "All rows" : "Duplicate rows"} · rules {ui.state.importWizard!.previewRules ? "ON" : "OFF"}</text>
        <Show when={previewRows().length} fallback={<text fg={ink.note}>No rows in this view.</text>}>
          <For each={previewWindow()}>{(row, i) => (
            <ListRow cursor={previewTop() + i() === ui.state.importWizard!.previewCursor} bg={theme.mantle} spans={[
              row.duplicate ? { text: "! ", fg: tone.caution } : { text: "· ", fg: ink.rule },
              { text: `${row.dateISO} `, fg: ink.label },
              { text: fit(row.description, 38), fg: ink.figure },
              { text: formatMoney(row.amount).padStart(12), fg: ink.figure },
            ]} />
          )}</For>
          <Show when={previewRows().length > PREVIEW_ROWS}><text fg={ink.note}>{`─ ${windowLabel(previewTop(), PREVIEW_ROWS, previewRows().length)} ─`}</text></Show>
        </Show>
      </Modal>
    )}</Show>
  </>
}

function FactoryResetOverlay() { return <Show when={ui.state.factoryReset !== null}><Modal title="Factory-reset database" tone="error" hints="enter erase · esc cancel"><text fg={tone.bad}>Removes the SQLite database and its transaction, account, taxonomy, and rule data.</text><text fg={ink.note}>Saved filters and import profiles remain in OpenTUI config.</text><text fg={tone.bad}>Type RESET: <TextInput field={{ value: ui.state.factoryReset!.draft, caret: ui.state.factoryReset!.caret }} focused /></text></Modal></Show> }

export function EditorOverlay() {
  const ctx = () => ({ accounts: data.state.accounts, categories: data.state.categories, tags: data.state.tags, savedFilters: data.state.savedFilters, transactions: data.transactions() })
  return (
    <Show when={ui.state.settingsEditor}>
      {(editor: () => NonNullable<typeof ui.state.settingsEditor>) => {
        const kind = () => editor().kind
        const fields = () => editorFields(kind(), ui.state.settingsDraft, ctx())
        const cursor = () => Math.min(ui.state.settingsEditor!.field, fields().length - 1)
        const field = () => fields()[cursor()]!
        // Sized to its content (border and padding: 4), and steady while
        // moving between fields: every kind's hint line counts.
        const hints = () => fields().map((f) => EDITOR_HINTS[f.kind]).reduce((a, b) => (b.length > a.length ? b : a), "")
        // Solid tracks only the expression/filter and evaluation data, not the name or caret.
        const note = createMemo(() => editorNote(kind(), ui.state.settingsDraft, ctx()))
        const width = () => 4 + editorWidth(fields(), note(), hints())
        return (
          <>
            <Modal
              title={kind() === "cycle" || kind() === "pay" ? EDITOR_TITLE[kind()] : `${ui.state.settingsEditor!.id == null ? "New" : "Edit"} ${EDITOR_TITLE[kind()].toLowerCase()}`}
              width={width()}
              hints={EDITOR_HINTS[field().kind]}
            >
              <Form fields={fields()} cursor={cursor()} caret={ui.state.settingsEditor!.caret} note={note()} />
            </Modal>
            <Show when={ui.state.settingsEditor!.picker}>
              {(picker: () => NonNullable<NonNullable<typeof ui.state.settingsEditor>["picker"]>) => (
                <ListPicker
                  title={field().label}
                  subtitle={EDITOR_TITLE[kind()]}
                  items={pickerItems(kind(), field().key, ctx(), picker().query)}
                  cursor={picker().cursor}
                  query={picker().query}
                  mark={field().multi ? (value) => (ui.state.settingsDraft[field().key as "addTagIds" | "categoryIds"].includes(Number(value)) ? "[x]" : "[ ]") : undefined}
                  iconFor={field().key === "categoryId" || field().key === "setCategoryId" ? (value) => (value == null ? undefined : categoryMark(Number(value))) : undefined}
                  hints={field().multi ? "↑↓ move · enter toggle · esc done" : "↑↓ move · enter choose · esc back"}
                />
              )}
            </Show>
          </>
        )
      }}
    </Show>
  )
}

/** The settings editor's hint line for the focused field's kind. */
const EDITOR_HINTS: Record<FormField["kind"], string> = {
  text: "↑↓ field · enter save · esc cancel",
  choice: "↑↓ field · ←→ change · enter save · esc cancel",
  toggle: "↑↓ field · ←→ change · enter save · esc cancel",
  picker: "↑↓ field · enter choose · esc cancel",
}

/** The box a section's pane sits in: what the column scrolls into view. */
const paneId = (section: SectionId) => `settings-pane-${section === "set.tags" ? "set.categories" : section === "set.filters" ? "set.rules" : section}`

export function SettingsTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  // Panes keep their own height; a column taller than the screen scrolls,
  // following the focused pane.
  const columns: ScrollBoxRenderable[] = []
  createEffect(() => {
    const id = paneId(props.focused)
    for (const column of columns) column.scrollChildIntoView(id)
  })
  // In the lists drawn whole (Rules, Saved Filters, Appearance, Database), the cursor row too.
  createEffect(() => {
    if (!ui.state.settingsActive) return
    const id = ui.state.settingsSection === "rules" ? `settings-rule-${ui.state.ruleCursor}` : ui.state.settingsSection === "filters" ? `settings-filter-${ui.state.filterCursor}`
      : ui.state.settingsSection === "appearance" ? `settings-appearance-${ui.state.appearanceCursor}`
      : ui.state.settingsSection === "database" ? `settings-database-${ui.state.databaseCursor}` : null
    if (id) for (const column of columns) column.scrollChildIntoView(id)
  })
  const Column = (column: { width?: number; children: JSX.Element }) => (
    <scrollbox ref={(box: ScrollBoxRenderable) => {
      columns.push(box)
      onCleanup(() => columns.splice(columns.indexOf(box), 1))
      // A first layout or a resize moves the panes: follow focus again. On
      // the content's "resize" event, which comes after its onSizeChange (the
      // scrollbox's own: it updates the scroll range), so that isn't replaced.
      // After the frame's layout, not in it: the content is resized before
      // its panes are placed, and a pane read then is where it was (a pane
      // focused low in the column stayed off screen on opening).
      const follow = () => queueMicrotask(() => { if (!box.isDestroyed) box.scrollChildIntoView(paneId(props.focused)) })
      // The viewport too: a shorter screen can leave the content's height
      // as it was (Taxonomy at its own height) while the view shrinks.
      box.content.on("resize", follow)
      box.viewport.on("resize", follow)
      onCleanup(() => { box.content.off("resize", follow); box.viewport.off("resize", follow) })
    }}
      width={column.width} flexGrow={column.width ? 0 : 1} flexShrink={column.width ? 0 : 1} minWidth={0} height="100%"
      scrollY scrollX={false} focusable={false} verticalScrollbarOptions={{ visible: false }} contentOptions={{ flexDirection: "column" }}>
      {column.children}
    </scrollbox>
  )
  // Wide: Taxonomy over Rules & Filters on the left (full width of the
  // column); on the right Up Bank, AI models, Appearance
  // beside Database & Import (each
  // pair one height), stacked when the column is too narrow for pairs.
  // Narrower: one column in the same order (SETTINGS_SECTIONS).
  const left = () => Math.floor(dims().width * 0.5)
  const right = () => dims().width - 1 - left()
  const full = () => dims().width
  // The tab's body: the screen less the tab bar, its gap, the status and the footer.
  const body = () => dims().height - 4
  // Each pane registers where it is (h/l go to the one beside) and
  // activates on a click anywhere in it (a row's own click also moves the cursor).
  const Pane = (pane: { section: SectionId; settings: SettingsSection; width?: number; children: JSX.Element }) =>
    <box id={paneId(pane.section)} ref={regionRef(pane.section, "settings")} width={pane.width ?? "100%"} flexShrink={0} onMouseDown={onSettings(() => ui.activateSettings(pane.settings))}>{pane.children}</box>
  /** Two panes side by side, one height. */
  const Pair = (pair: { children: JSX.Element }) => <box flexDirection="row" gap={1} width="100%" flexShrink={0}>{pair.children}</box>
  const taxonomyFocused = () => props.focused === "set.categories" || props.focused === "set.tags"
  const taxonomy = (width: number, room: number) => <Pane section="set.categories" settings="taxonomy"><TaxonomyPane focused={taxonomyFocused()} height={taxonomyHeight(width, room)} width={width} /></Pane>
  const rules = (width: number) => <Pane section="set.rules" settings="rules"><RulesPane focused={props.focused === "set.rules" || props.focused === "set.filters"} width={width} /></Pane>
  const up = (width: number, height?: number) => <Pane section="set.up" settings="up" width={width}><UpPane focused={props.focused === "set.up"} width={width} height={height} /></Pane>
  const ai = (width: number) => <Pane section="set.ai" settings="ai"><AiPane focused={props.focused === "set.ai"} width={width} /></Pane>
  const appearance = (width: number, height?: number) => <Pane section="set.appearance" settings="appearance" width={width}><AppearancePane focused={props.focused === "set.appearance"} width={width} height={height} /></Pane>
  const database = (width: number, height?: number) => <Pane section="set.database" settings="database" width={width}><DatabasePane focused={props.focused === "set.database"} width={width} height={height} /></Pane>
  // Pairs need room for Up Bank's rows and Database's values beside their partners.
  const pairs = () => right() >= 100
  // The setup's backdrop behind the panes (Backdrop); the panes over it.
  return <box width="100%" height="100%" backgroundColor={theme.canvas}>
    <SettingsBackdrop />
    <box zIndex={1} width="100%" height="100%" flexDirection="row" gap={1}>
    <Show when={dims().width >= 112} fallback={
      <Column>
        {taxonomy(full(), dims().height - 6)}{rules(full())}{up(full())}{ai(full())}{appearance(full())}{database(full())}
      </Column>
    }>
      <Column width={left()}>{taxonomy(left(), body() - rulesHeight())}{rules(left())}</Column>
      <Column>
        {up(right())}
        {ai(right())}
        <Show when={pairs()} fallback={<>{appearance(right())}{database(right())}</>}>
          <Pair>{appearance(APPEARANCE_WIDTH, DATABASE_ROWS.length + 5)}{database(right() - 1 - APPEARANCE_WIDTH, DATABASE_ROWS.length + 5)}</Pair>
        </Show>
      </Column>
    </Show>
    </box>
    <ImportOverlay />
    <ImportHistoryDialog />
    <FactoryResetOverlay />
    {/* Last, so a confirmation armed from a dialog shows over it. */}
  </box>
}

export function DryRunOverlay() {
  const dims = useTerminalDimensions()
  const lines = createMemo(() => {
    const report = ui.state.dryRun?.report
    if (!report) return []
    const rows: { text: string; error?: boolean }[] = []
    for (const [index, result] of report.rules.entries()) {
      rows.push({ text: `${index + 1}. ${result.rule.name}` }, { text: `  filter:${result.rule.savedFilterId}${result.error ? ` · ${result.error}` : ""}`, error: !!result.error }, { text: `  matched ${result.matched} · category ${result.categoryChanges} · tags ${result.tagChanges}` })
      for (const sample of result.samples) {
        const category = sample.categoryId == null ? "" : ` → ${data.state.categories.find((category) => category.id === sample.categoryId)?.name ?? sample.categoryId}`
        const tags = sample.addedTagIds.map((id) => ` +${data.state.tags.find((tag) => tag.id === id)?.name ?? id}`).join("")
        const prefix = `    ${sample.transaction.dateISO} `
        const suffix = ` ${formatMoney(sample.transaction.amount)}${category}${tags}`
        const width = Math.min(96, dims().width - 4) - 4
        const description = fit(sample.transaction.description, Math.max(1, Math.min(32, width - Bun.stringWidth(prefix + suffix))))
        rows.push({ text: `${prefix}${description}${suffix}` })
      }
      rows.push({ text: "" })
    }
    if (!report.rules.length) rows.push({ text: "No enabled rules to evaluate." })
    return rows
  })
  const visible = () => Math.max(1, dims().height - 10)
  createEffect(() => { if (ui.state.dryRun?.report && (ui.state.dryRun?.visible ?? 10) !== visible()) ui.setState("dryRun", { visible: visible() }) })
  const top = () => Math.min((ui.state.dryRun?.scroll ?? 0), Math.max(0, lines().length - visible()))
  return <Show when={ui.state.dryRun?.report}>{(report: () => NonNullable<typeof ui.state.dryRun>["report"]) => <Modal title="Dry run" width={96} hints="j/k scroll · esc close">
    <text fg={ink.note} wrapMode="none">{`All ${report().transactionCount} transactions`}</text>
    <text fg={ink.note} wrapMode="none">{`${report().updatedTransactions} transactions would change · ${report().categoryChanges} categories · ${report().tagChanges} tags${report().failedRules.length ? ` · failed rules: ${report().failedRules.join(", ")}` : ""}`}</text>
    <text> </text>
    <box flexDirection="column" height={Math.min(visible(), lines().length)} overflow="hidden"><For each={lines().slice(top(), top() + visible())}>{(line) => <text fg={line.error ? tone.bad : ink.figure} wrapMode="none">{line.text || " "}</text>}</For></box>
  </Modal>}</Show>
}
