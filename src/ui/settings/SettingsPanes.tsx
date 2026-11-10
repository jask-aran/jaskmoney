import { onPointer } from "../../app/pointer"
import type { MouseEvent } from "@opentui/core"
import type { ScopeId } from "../../state/uiStore"
import { ink, theme, tone } from "../../theme"
import { settingMark, type SettingIcon } from "../icons"
import { ListRow } from "../primitives/ListRow"
import type { Span } from "../primitives/spans"
import { armedFor } from "../../state/armed"
import { For, Show, createMemo } from "solid-js"
import { SectionCard } from "../primitives/SectionCard"
import { ui, SETTINGS_SECTION_LABELS } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { parseFilterStrict } from "../../domain/filter"
import { fit, truncate } from "../text"
import { APPEARANCE_ROWS, appearanceRow } from "../../state/appearanceRows"
import { swatches, themeDef } from "./ThemePicker"
import { DATABASE_ROWS, databaseRow } from "../../state/databaseRows"
import { syncAgo } from "../../app/sync"
import { aiConnection, aiContext, AI_USES, aiRow, useModel } from "../../state/aiDialog"
import { spinnerFrame } from "../primitives/Spinner"
import { AI_ROWS } from "../../app/apiKeys"
import { USES } from "../../ai/catalog"
import { executorRow } from "../../state/executorDialog"
import { executorSignedIn } from "../../ai/executor"

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
export const onSettings = (action: (event: MouseEvent) => void) => onPointer((scope) => SETTINGS_SCOPES.has(scope), action)

/** A line of a pane that isn't a cursor row: a subheading, a note, a blank. */
export function Line(props: { spans: Span[] }) {
  return <ListRow cursor={false} bg={theme.canvas} spans={props.spans} />
}
export const heading = (label: string, n?: number, note = ""): Span[] => [
  { text: label, fg: ink.heading, bold: true },
  ...(n != null ? [{ text: ` ${n}${note}`, fg: ink.note }] : []),
]

/** Between Taxonomy's columns. */
export const COLUMN_GAP = 2

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
export const rulesHeight = () => 2 + 1 + Math.max(1, data.state.rules.length) + 1 + 1 + Math.max(1, data.state.savedFilters.length)

/** Rules and the saved filters they match, in one card: Rules (ordered,
 * last match wins) above Saved filters. Each list is its own section (its
 * keys and cursor); j/k run on from one into the other. A rule's mark says
 * whether it runs: on, off, or its filter broken or gone. */
export function RulesPane(props: { focused: boolean; width: number }) {
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
export const APPEARANCE_WIDTH = 40

/** Appearance: each preference with its icon; the theme with its colours,
 * a toggle as on or off, a choice with which of its options is set. */
export function AppearancePane(props: { focused: boolean; width: number; height?: number }) {
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
export function DatabasePane(props: { focused: boolean; width: number; height?: number }) {
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

/** Up Bank's height: borders and its rows, and the last sync's error. */
const upHeight = () => 6 + (data.state.dbInfo?.upLastError ? 1 : 0)

/** Up Bank: the token, sync and which accounts are linked; enter on a row
 * opens it (the token's dialog, a sync now, the accounts dialog). The token
 * itself is never rendered. Each row's mark says how it stands; Sync's
 * spins while a sync runs. */
export function UpPane(props: { focused: boolean; width: number; height?: number }) {
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
export function AiPane(props: { focused: boolean; width: number }) {
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
