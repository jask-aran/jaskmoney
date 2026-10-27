import { armedFor } from "../../state/armed"
import { DATABASE_ROWS, databaseRow } from "../../state/databaseRows"
import { AI_ROWS } from "../../app/apiKeys"
import { syncAgo } from "../../app/sync"
import { AI_NAMES, aiActionHint, aiActions, aiConnection, aiContext, aiRow, aiStatus } from "../../state/aiDialog"
import { secretDisplay } from "../../state/settingsForm"
import { SignInBody } from "../primitives/SignInBody"
import { For, Show, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import { TextInput } from "../primitives/TextInput"
import type { SectionId, SettingsList, UiState } from "../../state/uiStore"
import { SETTINGS_SECTION_LABELS, ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { parseFilterStrict } from "../../domain/filter"
import { theme } from "../../theme"
import { count, fit, truncate } from "../text"
import { formatMoney } from "../../domain/dashboard"
import { accountRole } from "../../domain/types"
import { budgetLabel } from "../../domain/budgetScopes"
import { describeCycle } from "../../domain/budget"
import { Modal } from "../primitives/Modal"
import { categoryMark } from "../icons"
import { Form } from "../primitives/Form"
import { ListPicker } from "../primitives/ListPicker"
import { ListRow, centredTop, windowLabel } from "../primitives/ListRow"
import { EDITOR_TITLE, editorFields, editorNote, editorWidth, pickerItems, type FormField } from "../../state/settingsForm"

function ListFooter(props: { top: number; visible: number; count: number }) {
  return <text fg={theme.overlay1}>{`─ ${windowLabel(props.top, props.visible, props.count)} ─`}</text>
}

/** A row's text width in a pane `width` columns wide: border and padding
 * (4) and the cursor marker (2). */
const rowWidth = (width: number) => Math.max(10, width - 6)

/** A tag's scope in words: "in Holidays & Travel" for one category, else
 * the filter itself. */
function scopeText(scope: string): string {
  const one = /^cat:(?:"([^"]+)"|(\S+))$/.exec(scope.trim())
  return one ? `in ${one[1] ?? one[2]}` : scope
}

function TaxonomyList(props: { kind: SettingsList; width: number }) {
  const categories = () => data.state.categories
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "taxonomy" && ui.state.taxonomyList === props.kind
  const rows = () => props.kind === "categories" ? categories() : data.state.tags
  const cursor = () => props.kind === "categories" ? ui.state.categoryCursor : ui.state.tagCursor
  const top = () => props.kind === "categories" ? ui.state.categoryTop : ui.state.tagTop
  const visible = () => props.kind === "categories" ? ui.state.categoryVisible : ui.state.tagVisible
  const windowRows = createMemo(() => rows().slice(top(), top() + visible()))
  const parents = createMemo(() => new Set(categories().map((c) => c.parentId).filter((id) => id != null)))
  // A category is drawn under its group (indented) when it follows it in
  // the list; one listed elsewhere names its group instead.
  const underGroup = createMemo(() => {
    const under = new Set<number>()
    let group: number | null = null
    for (const c of categories()) {
      if (c.parentId == null) group = c.id
      else if (c.parentId === group) under.add(c.id)
    }
    return under
  })

  createEffect(() => {
    const count = rows().length
    const current = cursor()
    if (count === 0 && current !== 0) ui.setState(props.kind === "categories" ? { categoryCursor: 0, categoryTop: 0 } : { tagCursor: 0, tagTop: 0 })
    else if (count > 0 && current >= count) ui.moveSettingsList(props.kind, count - 1 - current, count)
  })

  // Name, then a note (a category's kind, a tag's scope) in a column as wide
  // as the longest note, so the name takes the rest.
  const width = () => props.width - 2
  const noteOf = (row: ReturnType<typeof rows>[number]) => {
    if (props.kind === "tags") return scopeText((row as typeof data.state.tags[number]).scope ?? "")
    const c = row as typeof data.state.categories[number]
    const parent = c.parentId != null && !underGroup().has(c.id) ? categories().find((p) => p.id === c.parentId)?.name : null
    return c.isDefault ? "default" : parent ? `in ${parent}` : c.income ? "income" : c.notSpending ? "not spending" : ""
  }
  const NOTE = createMemo(() => Math.min(width() - 2 - 1 - 12, Math.max(0, ...rows().map((row) => noteOf(row).length))))
  return (
    <box width={props.width} flexShrink={0} flexDirection="column" backgroundColor={theme.canvas}>
      <text height={1} wrapMode="none">
        <S fg={active() ? theme.focus : theme.subtext1} bold>{props.kind === "categories" ? "Categories" : "Tags"}</S>
        <S fg={theme.overlay1}>{` ${rows().length}`}</S>
      </text>
      <box flexGrow={1} flexDirection="column"><Show when={rows().length} fallback={<text fg={theme.overlay1}>{`No ${props.kind}. Press a to add.`}</text>}>
        <For each={windowRows()}>{(row, index) => {
          const absolute = () => top() + index()
          const selected = () => active() && absolute() === cursor()
          const category = () => props.kind === "categories" ? row as typeof data.state.categories[number] : null
          // Categories: a group bold, the ones in it indented under it.
          const child = () => underGroup().has(row.id)
          const group = () => parents().has(row.id)
          const note = () => noteOf(row)
          const nameWidth = () => width() - 2 - (child() ? 2 : 0) - (note() ? NOTE() + 1 : 0)
          return <ListRow cursor={selected()} bg={theme.canvas} armed={armedFor(ui.state.armed, category() ? "category" : "tag", row.id)} spans={[
            ...(child() ? [{ text: "  ", fg: theme.canvas }] : []),
            { text: `${category() ? categoryMark(row.id) : "●"} `, fg: row.color },
            { text: fit(row.name, nameWidth()), fg: group() || !category() ? theme.text : theme.subtext1, bold: group() || selected() },
            ...(note() ? [{ text: ` ${truncate(note(), NOTE())}`, fg: theme.overlay1 }] : []),
          ]} />
        }}</For>
      </Show></box>
      <box height={1}><ListFooter top={top()} visible={visible()} count={rows().length} /></box>
    </box>
  )
}

function BudgetsPane(props: { focused: boolean; width: number }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "budgets"
  const budgets = () => data.state.budgets
  // Label and amount side by side, not spread across a wide pane.
  const label = () => Math.min(36, rowWidth(props.width) - 13)
  return <SectionCard title={SETTINGS_SECTION_LABELS.budgets} focused={props.focused} active={active()} height={Math.max(1, budgets().length) + 3} width={props.width}>
    <ListRow cursor={active() && ui.state.budgetCursor === 0} bg={theme.canvas} spans={[{ text: fit("Cycle", 14), fg: theme.subtext0 }, { text: describeCycle(data.state.budgetCycle), fg: theme.text }]} />
    <Show when={budgets().length} fallback={<text fg={theme.overlay1}>{active() ? "  No budgets. Press a to add." : "  No budgets yet."}</text>}>
      <For each={budgets()}>{(budget, i) => (
        <ListRow cursor={active() && ui.state.budgetCursor === i() + 1} bg={theme.canvas} armed={armedFor(ui.state.armed, "budget", budget.id)} spans={[
          { text: fit(budgetLabel(budget, data.state.accounts, data.state.categories), label()), fg: theme.text },
          { text: formatMoney(budget.amount).padStart(13), fg: theme.subtext1 },
        ]} />
      )}</For>
    </Show>
  </SectionCard>
}

function TaxonomyPane(props: { focused: boolean; narrow: boolean; width: number; height?: number | "auto" | `${number}%` }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "taxonomy"
  // Split: the two lists share the content width with a 3-column gap.
  const half = () => Math.floor((props.width - 4 - 3) / 2)
  return <SectionCard title={SETTINGS_SECTION_LABELS.taxonomy} focused={props.focused} active={active()} height={props.height} flexGrow={props.height ? 0 : 1} width={props.width}>
    <Show when={props.narrow} fallback={<box width="100%" flexGrow={1} flexDirection="row" gap={3}><TaxonomyList kind="categories" width={half()} /><TaxonomyList kind="tags" width={props.width - 4 - 3 - half()} /></box>}>
      <TaxonomyList kind={ui.state.taxonomyList} width={props.width - 4} />
    </Show>
  </SectionCard>
}

/** Rules and the saved filters they match, in one card: Rules (ordered,
 * first match wins) above Saved filters. Each list is its own section (its
 * keys, cursor and jump); the card shows whichever has focus. */
function RulesPane(props: { focused: boolean; width: number }) {
  const rulesActive = () => ui.state.settingsActive && ui.state.settingsSection === "rules"
  const filtersActive = () => ui.state.settingsActive && ui.state.settingsSection === "filters"
  const rules = () => data.state.rules
  const filters = () => data.state.savedFilters
  const heading = (label: string, n: number, on: boolean, note = "") => <text height={1} wrapMode="none"><S fg={on ? theme.focus : theme.subtext1} bold>{label}</S><S fg={theme.overlay1}>{` ${n}${note}`}</S></text>
  const nameWidth = () => Math.min(28, Math.floor(rowWidth(props.width) * 0.32))
  const setWidth = () => Math.min(30, Math.floor(rowWidth(props.width) * 0.3))
  const idWidth = () => Math.min(22, Math.max(...filters().map((f) => f.id.length + 7), 12))
  const height = () => 2 + 1 + Math.max(1, rules().length) + 1 + 1 + Math.max(1, filters().length)
  return <SectionCard title="Rules & Filters" focused={props.focused} active={rulesActive() || filtersActive()} height={height()} width={props.width}>
    {heading("Rules", rules().length, rulesActive(), rules().length > 1 ? " · first match wins" : "")}
    <Show when={rules().length} fallback={<text fg={theme.overlay1}>{rulesActive() ? "  No rules. Press a to add." : "  No rules yet."}</text>}>
      <For each={rules()}>{(rule, i) => {
        const cat = () => data.state.categories.find((c) => c.id === rule.setCategoryId)?.name
        const tags = () => rule.addTagIds.map((id) => data.state.tags.find((t) => t.id === id)?.name).filter(Boolean).map((name) => `+${name}`).join(" ")
        const filter = () => filters().find((filter) => filter.id === rule.savedFilterId)
        const healthy = createMemo(() => { const parsed = parseFilterStrict(filter()?.expr ?? ""); return !!parsed.node && !parsed.error })
        const on = () => rule.enabled
        const matches = () => !filter() ? `missing filter ${rule.savedFilterId}` : healthy() ? `filter:${rule.savedFilterId}` : `broken filter:${rule.savedFilterId}`
        const sets = () => [cat() ? `→ ${cat()}` : "", tags()].filter(Boolean).join(" ") || "→ nothing"
        return <ListRow id={`settings-rule-${i()}`} cursor={rulesActive() && ui.state.ruleCursor === i()} bg={theme.canvas} armed={armedFor(ui.state.armed, "rule", rule.id)} spans={[
          { text: `${String(i() + 1).padStart(2)}  `, fg: theme.overlay1 },
          { text: fit(`${rule.name}${on() ? "" : " (off)"}`, nameWidth()), fg: on() ? theme.text : theme.overlay1 },
          { text: `  ${fit(sets(), setWidth())}`, fg: on() ? theme.teal : theme.overlay1 },
          { text: `  ${matches()}`, fg: !on() ? theme.overlay1 : filter() && healthy() ? theme.overlay1 : theme.error },
        ]} />
      }}</For>
    </Show>
    <text> </text>
    {heading("Saved filters", filters().length, filtersActive())}
    <Show when={filters().length} fallback={<text fg={theme.overlay1}>{filtersActive() ? "  No saved filters. Press a to add." : "  No saved filters yet."}</text>}>
      <For each={filters()}>{(filter, i) => (
        <ListRow id={`settings-filter-${i()}`} cursor={filtersActive() && ui.state.filterCursor === i()} bg={theme.canvas} armed={armedFor(ui.state.armed, "filter", filter.id)} spans={[
          { text: fit(filter.name, nameWidth() + 4), fg: theme.text },
          { text: `  ${fit(`filter:${filter.id}`, idWidth())}`, fg: theme.teal },
          { text: `  ${filter.expr}`, fg: theme.overlay1 },
        ]} />
      )}</For>
    </Show>
  </SectionCard>
}

/** The database: where it is and what it holds, then its settings and
 * actions as rows (always shown; the cursor only while active). */
function DatabasePane(props: { focused: boolean; width: number; height?: number | "auto" | `${number}%` }) {
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
  const ctx = () => ({ icons: data.state.icons, weekStart: data.state.weekStart, xAxis: !!data.state.uiPrefs.xAxis, profiles: data.state.importProfiles.length, demo: data.state.demo })
  return <SectionCard title={SETTINGS_SECTION_LABELS.database} focused={props.focused} active={active()} height={props.height ?? DATABASE_ROWS.length + 5} flexGrow={0} width={props.width}>
    <text wrapMode="none"><S fg={theme.subtext1}>{`  ${truncate(where(), rowWidth(props.width))}`}</S></text>
    <text wrapMode="none"><S fg={theme.overlay1}>{`  ${truncate(holds(), rowWidth(props.width))}`}</S></text>
    <text> </text>
    <For each={DATABASE_ROWS}>{(row, i) => {
      const view = () => databaseRow(row, ctx())
      return <ListRow cursor={active() && ui.state.databaseCursor === i()} bg={theme.canvas} armed={row === "clearData" ? armedFor(ui.state.armed, "clearData", 0) : undefined} spans={[
        { text: fit(view().label, 20), fg: view().danger ? theme.error : theme.text },
        ...(view().value != null ? [{ text: view().value!, fg: view().danger ? theme.overlay1 : theme.subtext1 }] : []),
      ]} />
    }}</For>
  </SectionCard>
}

/** Up Bank: the token, sync and which accounts are linked; enter on a row
 * opens it (the token's dialog, a sync now, the accounts dialog). The token
 * itself is never rendered. */
function UpPane(props: { focused: boolean; width: number }) {
  const info = () => data.state.dbInfo
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "up"
  const connection = () => aiConnection("up", aiContext(data))
  const accounts = () => data.state.syncAccounts
  const off = () => accounts().filter((a) => !a.syncEnabled)
  const synced = () => data.state.upSyncing ? "syncing…" : (() => { const ago = syncAgo(info()?.upLastSyncedAt ?? null, Date.now()); return ago ? `synced ${ago}` : "not synced yet" })()
  // How many sync; which are off when that fits, else just how many.
  const linked = () => {
    if (!accounts().length) return "none yet · they appear after a sync"
    const syncing = `${accounts().length - off().length} of ${accounts().length} syncing`
    const named = off().length ? `${syncing} · ${off().map((a) => a.name).join(", ")} off` : syncing
    return named.length <= rowWidth(props.width) - 11 ? named : syncing
  }
  const row = (i: number, label: string, value: string, fg: string) =>
    <ListRow cursor={active() && ui.state.upCursor === i} bg={theme.canvas} spans={[{ text: fit(label, 11), fg: theme.subtext0 }, { text: value, fg }]} />
  return <SectionCard title={SETTINGS_SECTION_LABELS.up} focused={props.focused} active={active()} height={5 + (info()?.upLastError ? 1 : 0)} width={props.width}>
    {row(0, "Token", connection() ? connection()!.short : "not set · enter to add", connection() ? theme.success : theme.warning)}
    {row(1, "Sync", connection() ? `${synced()} · on start and every 5 min` : "needs the token", data.state.upSyncing ? theme.peach : theme.text)}
    <Show when={info()?.upLastError}>{(error: () => string) => <text fg={theme.error} wrapMode="none">{`  ${" ".repeat(11)}${error()}`}</text>}</Show>
    {row(2, "Accounts", linked(), theme.text)}
  </SectionCard>
}

/** Which Up accounts sync: name, kind, on or off. New accounts, savers
 * included, sync from the start. */
export function UpAccountsDialog() {
  return (
    <Show when={ui.state.upAccounts}>
      {(d: () => NonNullable<UiState["upAccounts"]>) => (
        <Modal title="Up accounts" subtitle="which accounts sync" width={52} hints="j/k move · enter on/off · esc close">
          <Show when={data.state.syncAccounts.length} fallback={<text fg={theme.overlay1}>No accounts yet: they appear after a sync.</text>}>
            <For each={data.state.syncAccounts}>{(account, i) => {
              const on = () => account.syncEnabled
              return <ListRow cursor={d().cursor === i()} bg={theme.mantle} armed={armedFor(ui.state.armed, "desyncAccount", account.id)} spans={[
                { text: fit(account.name, 24), fg: on() ? theme.text : theme.overlay1 },
                { text: fit(accountRole(account) === "saver" ? "saver" : "spending", 10), fg: theme.overlay1 },
                { text: on() ? "● syncing" : "○ off", fg: on() ? theme.success : theme.overlay1 },
              ]} />
            }}</For>
          </Show>
          <text> </text>
          <text fg={theme.overlay1} wrapMode="word">Switching an account off removes its transactions here (enter twice); on brings them back at the next sync.</text>
        </Modal>
      )}
    </Show>
  )
}

/** AI models: one row per model (what, how it's connected, what for);
 * enter opens its dialog. */
function AiPane(props: { focused: boolean; width: number }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "ai"
  const rows = () => {
    const ctx = aiContext(data)
    return AI_ROWS.map((row) => aiRow(row, ctx))
  }
  // How each is connected, in a column as wide as the longest.
  const how = () => Math.max(...rows().map((row) => row.how.length)) + 2
  return <SectionCard title={SETTINGS_SECTION_LABELS.ai} focused={props.focused} active={active()} height={AI_ROWS.length + 2} width={props.width}>
    <For each={rows()}>{(row, i) => (
      <ListRow cursor={active() && ui.state.aiCursor === i()} bg={theme.canvas} spans={[
        { text: row.connected ? "● " : "○ ", fg: row.connected ? theme.success : theme.overlay1 },
        { text: fit(row.name, 11), fg: row.connected ? theme.text : theme.subtext0 },
        { text: fit(row.how, how()), fg: row.connected ? theme.subtext1 : theme.overlay1 },
        { text: row.uses, fg: row.uses.endsWith("in use") ? theme.teal : theme.overlay1 },
      ]} />
    )}</For>
  </SectionCard>
}

/** One model's dialog: how it's connected, then its actions; a field when
 * typing a key, account id or model; a browser sign-in in progress. */
export function AiDialog() {
  return (
    <Show when={ui.state.aiDialog}>
      {(d: () => NonNullable<UiState["aiDialog"]>) => {
        const ctx = () => aiContext(data)
        const actions = () => aiActions(d().row, ctx())
        const at = () => actions()[Math.min(d().cursor, actions().length - 1)]
        const signIn = () => (ui.state.llmSignIn?.provider === d().row ? ui.state.llmSignIn : null)
        const fieldLabel = (action: string) => (action === "key" ? (d().row === "up" ? "Token" : d().row === "workersAi" ? "API token" : "API key") : action === "accountId" ? "Account ID" : "Model")
        return (
          <Modal title={AI_NAMES[d().row].name} subtitle={AI_NAMES[d().row].by} width={AI_DIALOG_WIDTH}
            hints={signIn() ? (signIn()!.paste ? "enter send · esc cancel" : "esc cancel") : d().field ? "enter save · esc back" : "j/k move · enter do · esc close"}>
            <For each={aiStatus(d().row, ctx())}>{(line) => (
              <text wrapMode="none"><S fg={theme.overlay1}>{line.label.padEnd(12)}</S><S fg={theme.text}>{fit(line.value, AI_DIALOG_WIDTH - 16)}</S></text>
            )}</For>
            <text> </text>
            <Show when={signIn()} fallback={
              <Show when={d().field} fallback={
                <>
                  <For each={actions()}>{(action, i) => {
                    const here = () => i() === Math.min(d().cursor, actions().length - 1)
                    return <text wrapMode="none"><S fg={theme.accent} bold>{here() ? "› " : "  "}</S><S fg={action.id === "remove" ? theme.error : here() ? theme.text : theme.subtext0} bold={here()}>{action.id === "remove" && here() && d().armed ? "Press enter again to remove" : action.label}</S></text>
                  }}</For>
                  <Show when={at() && aiActionHint(d().row, at()!.id, ctx())}>
                    <text> </text>
                    <text fg={theme.overlay1} wrapMode="word">{aiActionHint(d().row, at()!.id, ctx())!}</text>
                  </Show>
                </>
              }>
                {(f: () => NonNullable<NonNullable<UiState["aiDialog"]>["field"]>) => (
                  <>
                    <text wrapMode="none">
                      <S fg={theme.overlay1}>{fieldLabel(f().action).padEnd(12)}</S>
                      {f().action === "key"
                        ? <S fg={f().value ? theme.text : theme.overlay0}>{secretDisplay(f().value)}</S>
                        : <TextInput field={{ value: f().value, caret: f().caret }} focused caretColor={theme.accent} />}
                    </text>
                    <text fg={theme.overlay1} wrapMode="word">{aiActionHint(d().row, f().action, ctx()) ?? ""}</text>
                  </>
                )}
              </Show>
            }>
              {(flow: () => NonNullable<UiState["llmSignIn"]>) => <SignInBody flow={flow()} width={AI_DIALOG_WIDTH - 4} />}
            </Show>
            <Show when={d().note}>
              {(n: () => NonNullable<NonNullable<UiState["aiDialog"]>["note"]>) => (
                <>
                  <text> </text>
                  <text fg={n().ok === true ? theme.success : n().ok === false ? theme.error : theme.overlay1} wrapMode="word">{n().text}</text>
                </>
              )}
            </Show>
          </Modal>
        )
      }}
    </Show>
  )
}

const AI_DIALOG_WIDTH = 78

function ImportHistory(props: { width: number; height?: number | "auto" | `${number}%` }) {
  const when = (iso: string) => { const d = new Date(iso.includes("T") ? iso : `${iso.replace(" ", "T")}Z`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" }) }
  const file = () => Math.min(36, rowWidth(props.width) - 32)
  return <SectionCard title="Import History" height={props.height} flexGrow={props.height ? 0 : 1} width={props.width}>
    <Show when={data.state.imports.length} fallback={<text fg={theme.overlay1}>No imports yet.</text>}>
      <For each={data.state.imports.slice(0, 4)}>{(item) => <text wrapMode="none"><S fg={theme.text}>{fit(item.filename, file())}</S><S fg={theme.subtext1}>{count(item.rowCount, "row").padStart(10)}</S><S fg={theme.overlay1}>{`  ${when(item.importedAt)}`}</S></text>}</For>
    </Show>
  </SectionCard>
}

const PREVIEW_ROWS = 8

function ImportOverlay() {
  const stage = () => ui.state.importStage
  const previewRows = () => { const p = ui.state.importPreview; return p ? (ui.state.importPreviewShowAll ? p.rows : p.rows.filter((row) => row.duplicate)) : [] }
  // The preview shows PREVIEW_ROWS rows at a time around the cursor.
  const previewTop = () => centredTop(ui.state.importPreviewCursor, previewRows().length, PREVIEW_ROWS)
  const previewWindow = () => previewRows().slice(previewTop(), previewTop() + PREVIEW_ROWS)
  const profile = () => ui.state.importProfileDraft
  const profileFields = () => [
    ["ID", profile().id], ["Name", profile().name], ["Account", profile().account], ["Type", profile().accountType], ["Prefix", profile().importPrefix], ["Header", profile().hasHeader ? "yes" : "no"], ["Delimiter", profile().delimiter], ["Date column", String(profile().dateColumn)], ["Amount column", String(profile().amountColumn)], ["Description columns", profile().descriptionColumns.join(",")], ["Join description tail", profile().descriptionJoin ? "yes" : "no"], ["Amount strip", profile().amountStrip], ["Date order", profile().dateFormat],
  ]
  return <>
    <Show when={stage() === "files"}>
      <Modal title="Import CSV" hints="enter select · p path · esc cancel">
        <text fg={theme.overlay1}>{ui.state.importDirectory}</text>
        <Show when={ui.state.importFiles.length} fallback={<text fg={theme.overlay1}>No CSV files here. Press p to enter a path.</text>}>
          <For each={ui.state.importFiles}>{(path, i) => (
            <ListRow cursor={i() === ui.state.importCursor} bg={theme.mantle} spans={[{ text: path.split(/[\\/]/).pop() ?? path, fg: theme.text }]} />
          )}</For>
        </Show>
      </Modal>
    </Show>
    <Show when={stage() === "path"}><Modal title="Import CSV path"><text fg={theme.text}><TextInput field={{ value: ui.state.importPath, caret: ui.state.importPathCaret }} focused /></text><text fg={theme.overlay1}>Enter an absolute path or one relative to the listed folder.</text></Modal></Show>
    <Show when={stage() === "profile"}>
      <Modal title={ui.state.importProfileManaging ? "Import profiles" : "Choose import profile"} hints="a new · e edit · del del delete · enter select · esc back">
        <Show when={data.state.importProfiles.length} fallback={<text fg={theme.overlay1}>No profiles yet. Press a to map this CSV.</text>}>
          <For each={data.state.importProfiles}>{(item, i) => (
            <ListRow cursor={i() === ui.state.importProfileCursor} bg={theme.mantle} armed={armedFor(ui.state.armed, "profile", item.id)} spans={[
              { text: item.name, fg: theme.text },
              { text: `  ${item.account} · ${item.importPrefix || "no prefix"}`, fg: theme.overlay1 },
            ]} />
          )}</For>
        </Show>
        <ListRow cursor={ui.state.importProfileCursor === data.state.importProfiles.length} bg={theme.mantle} spans={[{ text: "New mapped profile", fg: theme.teal }]} />
      </Modal>
    </Show>
    <Show when={stage() === "profileEditor"}><Modal title="Map CSV profile" hints={`tab field · h/l choices · enter ${ui.state.importPath ? "save and scan" : "save"} · esc back`}><For each={profileFields()}>{(entry, i) => <text><S fg={i() === ui.state.importProfileField ? theme.focus : theme.subtext0} bold={i() === ui.state.importProfileField}>{i() === ui.state.importProfileField ? "> " : "  "}{entry[0]}: </S><TextInput field={{ value: entry[1] ?? "", caret: ui.state.importProfileCaret }} focused={i() === ui.state.importProfileField && ![3, 5, 10, 12].includes(i())} /></text>}</For></Modal></Show>
    <Show when={stage() === "preview" && ui.state.importPreview}>{(p: () => NonNullable<typeof ui.state.importPreview>) => (
      <Modal title="Import preview" hints="s skip duplicates · a force import · p all/dupes · r rules · esc cancel">
        <text fg={theme.subtext0}>{p().filename} · {p().accountName} · {p().profile.name}</text>
        <text fg={theme.text}>Rows {p().rows.length} · <S fg={theme.success}>{p().newCount} new</S> · <S fg={theme.warning}>{p().duplicateCount} duplicates</S> · <S fg={p().errors.length ? theme.error : theme.success}>{p().errors.length} errors</S></text>
        <Show when={p().errors.length}>
          <For each={p().errors.slice(0, 4)}>{(err) => <text fg={theme.error}>{`line ${err.sourceLine}: ${err.message}`}</text>}</For>
          <text fg={theme.error}>Import blocked until parsing errors are fixed.</text>
        </Show>
        <text fg={theme.subtext0}>{ui.state.importPreviewShowAll ? "All rows" : "Duplicate rows"} · rules {ui.state.importPreviewRules ? "ON" : "OFF"}</text>
        <Show when={previewRows().length} fallback={<text fg={theme.overlay1}>No rows in this view.</text>}>
          <For each={previewWindow()}>{(row, i) => (
            <ListRow cursor={previewTop() + i() === ui.state.importPreviewCursor} bg={theme.mantle} spans={[
              row.duplicate ? { text: "! ", fg: theme.warning } : { text: "· ", fg: theme.success },
              { text: `${row.dateISO} `, fg: theme.overlay1 },
              { text: fit(row.description, 38), fg: theme.text },
              { text: formatMoney(row.amount).padStart(12), fg: theme.overlay1 },
            ]} />
          )}</For>
          <Show when={previewRows().length > PREVIEW_ROWS}><text fg={theme.overlay1}>{`─ ${windowLabel(previewTop(), PREVIEW_ROWS, previewRows().length)} ─`}</text></Show>
        </Show>
      </Modal>
    )}</Show>
  </>
}

function FactoryResetOverlay() { return <Show when={ui.state.factoryResetOpen}><Modal title="Factory-reset database" tone="error" hints="enter erase · esc cancel"><text fg={theme.error}>Removes the SQLite database and its transaction, account, taxonomy, and rule data.</text><text fg={theme.overlay1}>Saved filters and import profiles remain in OpenTUI config.</text><text fg={theme.text}>Type RESET: <TextInput field={{ value: ui.state.factoryResetDraft, caret: ui.state.factoryResetCaret }} focused /></text></Modal></Show> }

export function EditorOverlay() {
  const ctx = () => ({ accounts: data.state.accounts, categories: data.state.categories, tags: data.state.tags, savedFilters: data.state.savedFilters, transactions: data.transactions() })
  return (
    <Show when={ui.state.settingsEditor}>
      {(kind: () => NonNullable<typeof ui.state.settingsEditor>) => {
        const fields = () => editorFields(kind(), ui.state.settingsDraft, ctx())
        const cursor = () => Math.min(ui.state.settingsEditField, fields().length - 1)
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
              title={kind() === "cycle" ? EDITOR_TITLE.cycle : `${ui.state.settingsEditId == null ? "New" : "Edit"} ${EDITOR_TITLE[kind()].toLowerCase()}`}
              width={width()}
              hints={EDITOR_HINTS[field().kind]}
            >
              <Form fields={fields()} cursor={cursor()} caret={ui.state.settingsCaret} note={note()} />
            </Modal>
            <Show when={ui.state.formPicker}>
              {(picker: () => NonNullable<typeof ui.state.formPicker>) => (
                <ListPicker
                  title={field().label}
                  subtitle={EDITOR_TITLE[kind()]}
                  items={pickerItems(kind(), field().key, ctx(), picker().query)}
                  cursor={picker().cursor}
                  query={picker().query}
                  mark={field().multi ? (value) => (ui.state.settingsDraft.addTagIds.includes(Number(value)) ? "[x]" : "[ ]") : undefined}
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

/** Rows the Taxonomy lists show: as many as the screen allows beside the
 * other panes of its column, 5 to 15. The pane is exactly this tall, so
 * the list's window and its footer always fit inside it. */
function taxonomyRows(height: number, wide: boolean): number {
  return Math.max(5, Math.min(15, height - (wide ? 21 : 16)))
}

/** The box a section's pane sits in: what the column scrolls into view. */
const paneId = (section: SectionId) => `settings-pane-${section === "set.tags" ? "set.categories" : section === "set.filters" ? "set.rules" : section}`

export function SettingsTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  const layout = () => dims().width >= 112 ? "wide" : dims().width >= 80 ? "medium" : "narrow"
  const rows = () => taxonomyRows(dims().height, layout() === "wide")
  createEffect(() => {
    const visible = rows()
    if (ui.state.categoryVisible !== visible || ui.state.tagVisible !== visible) ui.setState({ categoryVisible: visible, tagVisible: visible })
  })
  const taxonomyFocused = () => props.focused === "set.categories" || props.focused === "set.tags"
  // Panes keep their own height; a column taller than the screen scrolls,
  // following the focused pane.
  const columns: ScrollBoxRenderable[] = []
  createEffect(() => {
    const id = paneId(props.focused)
    for (const column of columns) column.scrollChildIntoView(id)
  })
  // In the lists drawn whole (Rules, Saved Filters), the cursor row too.
  createEffect(() => {
    if (!ui.state.settingsActive) return
    const id = ui.state.settingsSection === "rules" ? `settings-rule-${ui.state.ruleCursor}` : ui.state.settingsSection === "filters" ? `settings-filter-${ui.state.filterCursor}` : null
    if (id) for (const column of columns) column.scrollChildIntoView(id)
  })
  const Column = (column: { width?: number; children: JSX.Element }) => (
    <scrollbox ref={(box: ScrollBoxRenderable) => {
      columns.push(box)
      onCleanup(() => columns.splice(columns.indexOf(box), 1))
      // A first layout or a resize moves the panes: follow focus again,
      // after the scrollbox's own handler (it updates the scroll range).
      const own = box.content.onSizeChange
      box.content.onSizeChange = () => { own?.call(box.content); box.scrollChildIntoView(paneId(props.focused)) }
    }}
      width={column.width} flexGrow={column.width ? 0 : 1} flexShrink={column.width ? 0 : 1} minWidth={0} height="100%"
      scrollY scrollX={false} focusable={false} verticalScrollbarOptions={{ visible: false }} contentOptions={{ flexDirection: "column" }}>
      {column.children}
    </scrollbox>
  )
  // Each pane's width: rows size their columns from it. Wide: Taxonomy
  // (and Budgets) in a 60% left column; the rest on the right, Rules &
  // Filters (they run on what comes in) just above Database & Import; medium: the tab, Up Bank and AI models halves.
  const left = () => Math.floor(dims().width * 0.6)
  const right = () => dims().width - 1 - left()
  const full = () => dims().width
  const half = () => Math.floor(dims().width * 0.5)
  const Pane = (pane: { section: SectionId; children: JSX.Element }) => <box id={paneId(pane.section)} width="100%" flexShrink={0}>{pane.children}</box>
  const taxonomy = (width: number) => <Pane section="set.categories"><TaxonomyPane focused={taxonomyFocused()} narrow={layout() === "narrow"} height={rows() + 4} width={width} /></Pane>
  const budgets = (width: number) => <Pane section="set.budgets"><BudgetsPane focused={props.focused === "set.budgets"} width={width} /></Pane>
  const rules = (width: number) => <Pane section="set.rules"><RulesPane focused={props.focused === "set.rules" || props.focused === "set.filters"} width={width} /></Pane>
  const up = (width: number) => <Pane section="set.up"><UpPane focused={props.focused === "set.up"} width={width} /></Pane>
  const ai = (width: number) => <Pane section="set.ai"><AiPane focused={props.focused === "set.ai"} width={width} /></Pane>
  const database = (width: number) => <Pane section="set.database"><DatabasePane focused={props.focused === "set.database"} width={width} /></Pane>
  const history = (width: number) => <box width="100%" flexShrink={0}><ImportHistory width={width} /></box>
  return <box width="100%" height="100%" flexDirection="row" gap={1} backgroundColor={theme.canvas}>
    <Show when={layout() === "wide"} fallback={
      <Column>
        {taxonomy(full())}{budgets(full())}
        <Show when={layout() === "medium"} fallback={<>{up(full())}{ai(full())}</>}>
          <box flexDirection="row" gap={1} width="100%" flexShrink={0}>
            <box id={paneId("set.up")} width={half()} flexShrink={0}><UpPane focused={props.focused === "set.up"} width={half()} /></box>
            <box id={paneId("set.ai")} flexGrow={1} minWidth={0}><AiPane focused={props.focused === "set.ai"} width={full() - 1 - half()} /></box>
          </box>
        </Show>
        {rules(full())}{database(full())}{history(full())}
      </Column>
    }>
      <Column width={left()}>{taxonomy(left())}{budgets(left())}</Column>
      <Column>{up(right())}{ai(right())}{rules(right())}{database(right())}{history(right())}</Column>
    </Show>
    <ImportOverlay />
    <FactoryResetOverlay />
    {/* Last, so a confirmation armed from a dialog shows over it. */}
  </box>
}

export function DryRunOverlay() {
  const dims = useTerminalDimensions()
  const lines = createMemo(() => {
    const report = ui.state.dryRunReport
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
  createEffect(() => { if (ui.state.dryRunReport && ui.state.dryRunVisible !== visible()) ui.setState({ dryRunVisible: visible() }) })
  const top = () => Math.min(ui.state.dryRunScroll, Math.max(0, lines().length - visible()))
  return <Show when={ui.state.dryRunReport}>{(report: () => NonNullable<typeof ui.state.dryRunReport>) => <Modal title="Dry run" width={96} hints="j/k scroll · esc close">
    <text fg={theme.subtext0} wrapMode="none">{`All ${report().transactionCount} transactions`}</text>
    <text fg={theme.text} wrapMode="none">{`${report().updatedTransactions} transactions would change · ${report().categoryChanges} categories · ${report().tagChanges} tags${report().failedRules.length ? ` · failed rules: ${report().failedRules.join(", ")}` : ""}`}</text>
    <text> </text>
    <box flexDirection="column" height={Math.min(visible(), lines().length)} overflow="hidden"><For each={lines().slice(top(), top() + visible())}>{(line) => <text fg={line.error ? theme.error : theme.text} wrapMode="none">{line.text || " "}</text>}</For></box>
  </Modal>}</Show>
}
