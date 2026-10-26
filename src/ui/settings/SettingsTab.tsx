import { For, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { muted } from "../primitives/spans"
import { S } from "../primitives/S"
import type { SectionId, SettingsList } from "../../state/uiStore"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"
import { fit } from "../text"
import { formatMoney } from "../../domain/dashboard"
import { accountRole } from "../../domain/types"
import { budgetLabel } from "../../domain/budgetScopes"
import { describeCycle } from "../../domain/budget"
import { Modal } from "../primitives/Modal"
import { categoryMark } from "../icons"
import { Form } from "../primitives/Form"
import { ListPicker } from "../primitives/ListPicker"
import { EDITOR_TITLE, editorFields, editorNote, editorWidth, pickerItems, type FormField } from "../../state/settingsForm"

function truncate(value: string, width: number) { return value.length <= width ? value : `${value.slice(0, Math.max(0, width - 1))}…` }

function ListFooter(props: { top: number; visible: number; count: number }) {
  return <text fg={theme.overlay1}>{props.count ? `─ ${props.top + 1}–${Math.min(props.top + props.visible, props.count)} of ${props.count} ─` : "─ empty ─"}</text>
}

function TaxonomyList(props: { kind: SettingsList; narrow?: boolean; split?: boolean }) {
  const categories = () => data.state.categories
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "taxonomy" && ui.state.taxonomyList === props.kind
  const rows = () => props.kind === "categories" ? categories() : data.state.tags
  const cursor = () => props.kind === "categories" ? ui.state.categoryCursor : ui.state.tagCursor
  const top = () => props.kind === "categories" ? ui.state.categoryTop : ui.state.tagTop
  const visible = () => props.kind === "categories" ? ui.state.categoryVisible : ui.state.tagVisible
  const title = () => `${props.kind === "categories" ? "Categories" : "Tags"} (${rows().length})`
  const windowRows = createMemo(() => rows().slice(top(), top() + visible()))
  const categoryName = (id: number | null) => categories().find((c) => c.id === id)?.name ?? "global"

  createEffect(() => {
    const count = rows().length
    const current = cursor()
    if (count === 0 && current !== 0) ui.setState(props.kind === "categories" ? { categoryCursor: 0, categoryTop: 0 } : { tagCursor: 0, tagTop: 0 })
    else if (count > 0 && current >= count) ui.moveSettingsList(props.kind, count - 1 - current, count)
  })

  return (
    <box width={props.split ? "50%" : undefined} flexGrow={1} flexDirection="column" backgroundColor={theme.canvas}>
      <text height={1} fg={active() ? theme.focus : theme.subtext0}>
        <b>{title()}</b>
      </text>
      <box flexGrow={1} flexDirection="column"><Show when={rows().length} fallback={<text fg={theme.overlay1}>No {props.kind}. Press a to add.</text>}>
        <For each={windowRows()}>{(row, index) => {
          const absolute = () => top() + index()
          const selected = () => active() && absolute() === cursor()
          const bg = () => selected() ? theme.surface0 : theme.canvas
          const isCategory = () => props.kind === "categories"
          const scope = () => {
            if (!isCategory()) return categoryName((row as typeof data.state.tags[number]).categoryId)
            const category = row as typeof data.state.categories[number]
            return [category.isDefault ? "default" : "", category.notSpending ? "not spending" : ""].filter(Boolean).join(", ")
          }
          return <text width="100%" bg={bg()}>
            <S fg={selected() ? theme.focus : theme.canvas} bg={bg()} bold>{selected() ? "> " : "  "}</S>
            <S fg={row.color} bg={bg()}>{`${isCategory() ? categoryMark(row.id) : "●"} `}</S>
            <S fg={theme.text} bg={bg()} bold={selected()}>{truncate(row.name, props.narrow ? 28 : 20)}</S>
            <Show when={scope()}><S fg={theme.overlay1} bg={bg()}>{` (${scope()})`}</S></Show>
          </text>
        }}</For>
      </Show></box>
      <box height={1}><ListFooter top={top()} visible={visible()} count={rows().length} /></box>
    </box>
  )
}

function BudgetsPane(props: { focused: boolean }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "budgets"
  const budgets = () => data.state.budgets
  return <SectionCard title="Budgets" focused={props.focused} active={active()} height={Math.max(1, budgets().length) + 4}>
    <text wrapMode="none"><S fg={theme.subtext0}>{"Cycle  "}</S><S fg={theme.text}>{describeCycle(data.state.budgetCycle)}</S></text>
    <Show when={budgets().length} fallback={<text fg={theme.overlay1}>{active() ? "No budgets. Press a to add." : "No budgets. Activate to add."}</text>}>
      <For each={budgets()}>{(budget, i) => {
        const selected = () => active() && ui.state.budgetCursor === i()
        const bg = () => (selected() ? theme.surface0 : theme.canvas)
        return <text bg={bg()} wrapMode="none">
          <S fg={theme.focus} bg={bg()} bold>{selected() ? "> " : "  "}</S>
          <S fg={theme.text} bg={bg()}>{fit(budgetLabel(budget, data.state.accounts, data.state.categories), 34)}</S>
          <S fg={theme.subtext1} bg={bg()}>{formatMoney(budget.amount).padStart(12)}</S>
        </text>
      }}</For>
    </Show>
  </SectionCard>
}

function TaxonomyPane(props: { focused: boolean; narrow: boolean; height?: number | "auto" | `${number}%` }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "taxonomy"
  return <SectionCard title="Taxonomy" focused={props.focused} active={active()} height={props.height} flexGrow={props.height ? 0 : 1}>
    <Show when={props.narrow} fallback={<box width="100%" flexGrow={1} flexDirection="row" gap={2}><TaxonomyList kind="categories" split /><TaxonomyList kind="tags" split /></box>}>
      <TaxonomyList kind={ui.state.taxonomyList} narrow />
    </Show>
  </SectionCard>
}

function RulesPane(props: { focused: boolean; height?: number | "auto" | `${number}%` }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "rules"
  const rows = () => data.state.rules
  return <SectionCard title="Rules" focused={props.focused} active={active()} height={props.height} flexGrow={props.height ? 0 : 1} bottomSpans={[muted(rows().length ? `${rows().length} ordered rule${rows().length === 1 ? "" : "s"}` : "empty")]}>
    <Show when={rows().length} fallback={<text fg={theme.overlay1}>{active() ? "No rules. Press a to add." : "No rules. Activate to add."}</text>}>
      <For each={rows()}>{(rule, i) => {
        const selected = () => active() && ui.state.ruleCursor === i()
        const bg = () => selected() ? theme.surface0 : theme.canvas
        const cat = () => data.state.categories.find((c) => c.id === rule.setCategoryId)?.name
        const tags = () => rule.addTagIds.map((id) => data.state.tags.find((t) => t.id === id)?.name).filter(Boolean).join(", ")
        return <text bg={bg()}><S fg={selected() ? theme.focus : theme.canvas} bg={bg()} bold>{selected() ? "> " : "  "}</S><S fg={rule.enabled ? theme.success : theme.overlay1} bg={bg()}>{rule.enabled ? "✓ " : "✗ "}</S><S fg={theme.text} bg={bg()}>{truncate(rule.name, 22)}</S><S fg={theme.overlay1} bg={bg()}>{` → ${cat() ?? "—"}${tags() ? ` +${tags()}` : ""}`}</S></text>
      }}</For>
    </Show>
  </SectionCard>
}

function FiltersPane(props: { focused: boolean; height?: number | "auto" | `${number}%` }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "filters"
  const rows = () => data.state.savedFilters
  return <SectionCard title="Saved Filters" focused={props.focused} active={active()} height={props.height} flexGrow={props.height ? 0 : 1}>
    <Show when={rows().length} fallback={<text fg={theme.overlay1}>{active() ? "No saved filters. Press a to add." : "No saved filters. Activate to add."}</text>}>
      <For each={rows()}>{(filter, i) => { const selected = () => active() && ui.state.filterCursor === i(); const bg = () => selected() ? theme.surface0 : theme.canvas; return <text bg={bg()}><S fg={selected() ? theme.focus : theme.canvas} bg={bg()} bold>{selected() ? "> " : "  "}</S><S fg={theme.teal} bg={bg()}>{filter.id}</S><S fg={theme.text} bg={bg()}>{`  ${truncate(filter.name, 16)}`}</S><S fg={theme.overlay1} bg={bg()}>{`  ${truncate(filter.expr, 20)}`}</S></text> }}</For>
    </Show>
  </SectionCard>
}

function DatabasePane(props: { focused: boolean; height?: number | "auto" | `${number}%` }) {
  const info = () => data.state.dbInfo
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "database"
  return <SectionCard title="Database & Import" focused={props.focused} active={active()} height={props.height} flexGrow={props.height ? 0 : 1}>
    {/* Gaps are expressions: Solid collapses runs of literal JSX spaces. */}
    <text fg={theme.subtext0}>{"Schema "}<S fg={theme.text}>v{info()?.schemaVersion ?? "—"}</S>{"   Transactions "}<S fg={theme.text}>{info()?.transactionCount ?? 0}</S>{"   Accounts "}<S fg={theme.text}>{info()?.accountCount ?? 0}</S></text>
    <text fg={theme.subtext0}>{"Categories "}<S fg={theme.text}>{info()?.categoryCount ?? 0}</S>{"   Tags "}<S fg={theme.text}>{info()?.tagCount ?? 0}</S>{"   Rules "}<S fg={theme.text}>{info()?.ruleCount ?? 0}</S></text>
    <text fg={theme.overlay1}>{`i import CSV · p manage profiles · n icons ${data.state.icons ? "on" : "off"}`}</text>
    <text fg={theme.overlay1}>c clear transactions/imports · x factory-reset database</text>
    <text fg={theme.overlay1}>Profiles {data.state.importProfiles.length} · imports {info()?.importCount ?? 0} · reset keeps filters and config</text>
  </SectionCard>
}

/** Up Bank sync: status plus one row per Up account with its sync switch.
 * Token presence is read from the environment (Bun loads .env); the value is
 * never rendered. */
function UpPane(props: { focused: boolean }) {
  const info = () => data.state.dbInfo
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "up"
  const tokenSet = () => !!process.env.JASKMONEY_UP_TOKEN?.trim()
  const accounts = () => data.state.syncAccounts
  return <SectionCard title="Up Bank" focused={props.focused} active={active()} height={Math.max(1, accounts().length) + 4}>
    <text wrapMode="none">
      <Show when={tokenSet()} fallback={<S fg={theme.warning}>Set JASKMONEY_UP_TOKEN to enable sync</S>}>
        <Show when={!data.state.upSyncing} fallback={<S fg={theme.peach}>Syncing…</S>}>
          <S fg={info()?.upLastSyncedAt ? theme.subtext0 : theme.overlay1}>
            {info()?.upLastSyncedAt ? `Last sync ${new Date(info()!.upLastSyncedAt!).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}` : "Token set · not synced yet"}
          </S>
        </Show>
      </Show>
    </text>
    <Show when={info()?.upLastError}>{(error: () => string) => <text fg={theme.error} wrapMode="none">{error()}</text>}</Show>
    <Show when={accounts().length} fallback={<text fg={theme.overlay1}>No accounts synced yet</text>}>
      <For each={accounts()}>{(account, i) => {
        const selected = () => active() && ui.state.upCursor === i()
        const bg = () => selected() ? theme.surface0 : theme.canvas
        const on = () => account.syncEnabled
        return <text bg={bg()} wrapMode="none">
          <S fg={theme.focus} bg={bg()} bold>{selected() ? "> " : "  "}</S>
          <S fg={on() ? theme.text : theme.overlay1} bg={bg()}>{fit(account.name, 16)}</S>
          <S fg={theme.overlay1} bg={bg()}>{fit(accountRole(account) === "saver" ? "saver" : "spending", 10)}</S>
          <S fg={on() ? theme.subtext1 : theme.overlay1} bg={bg()}>{fit(account.balance != null ? formatMoney(account.balance) : "—", 12)}</S>
          <S fg={on() ? theme.success : theme.overlay1} bg={bg()}>{on() ? "● sync on" : "○ sync off"}</S>
        </text>
      }}</For>
    </Show>
  </SectionCard>
}

function ImportHistory(props: { height?: number | "auto" | `${number}%` }) {
  return <SectionCard title="Import History" height={props.height} flexGrow={props.height ? 0 : 1}>
    <Show when={data.state.imports.length} fallback={<text fg={theme.overlay1}>No imports yet.</text>}>
      <For each={data.state.imports.slice(0, 4)}>{(item) => <text><S fg={theme.text}>{truncate(item.filename, 24)}</S><S fg={theme.overlay1}>{`  ${item.rowCount} rows  ${item.importedAt}`}</S></text>}</For>
    </Show>
  </SectionCard>
}


function ImportOverlay() {
  const stage = () => ui.state.importStage
  const previewRows = () => { const p = ui.state.importPreview; return p ? (ui.state.importPreviewShowAll ? p.rows : p.rows.filter((row) => row.duplicate)) : [] }
  const profile = () => ui.state.importProfileDraft
  const profileFields = () => [
    ["ID", profile().id], ["Name", profile().name], ["Account", profile().account], ["Type", profile().accountType], ["Prefix", profile().importPrefix], ["Header", profile().hasHeader ? "yes" : "no"], ["Delimiter", profile().delimiter], ["Date column", String(profile().dateColumn)], ["Amount column", String(profile().amountColumn)], ["Description columns", profile().descriptionColumns.join(",")], ["Join description tail", profile().descriptionJoin ? "yes" : "no"], ["Amount strip", profile().amountStrip], ["Date order", profile().dateFormat],
  ]
  return <>
    <Show when={stage() === "files"}><Modal title="Import CSV" hints="enter select · p path · esc cancel"><text fg={theme.overlay1}>{ui.state.importDirectory}</text><Show when={ui.state.importFiles.length} fallback={<text fg={theme.overlay1}>No CSV files here. Press p to enter a path.</text>}><For each={ui.state.importFiles}>{(path, i) => <text bg={i() === ui.state.importCursor ? theme.surface0 : theme.base}><S fg={i() === ui.state.importCursor ? theme.focus : theme.base} bg={i() === ui.state.importCursor ? theme.surface0 : theme.base} bold>{i() === ui.state.importCursor ? "> " : "  "}</S><S fg={theme.text} bg={i() === ui.state.importCursor ? theme.surface0 : theme.base}>{path.split(/[\\/]/).pop()}</S></text>}</For></Show></Modal></Show>
    <Show when={stage() === "path"}><Modal title="Import CSV path"><text fg={theme.text}>{ui.state.importPath}<S fg={theme.focus}>▌</S></text><text fg={theme.overlay1}>Enter an absolute path or one relative to the listed folder.</text></Modal></Show>
    <Show when={stage() === "profile"}><Modal title={ui.state.importProfileManaging ? "Import profiles" : "Choose import profile"} hints="a new · e edit · del delete · enter select · esc back"><Show when={data.state.importProfiles.length} fallback={<text fg={theme.overlay1}>No profiles yet. Press a to map this CSV.</text>}><For each={data.state.importProfiles}>{(item, i) => <text bg={i() === ui.state.importProfileCursor ? theme.surface0 : theme.base}><S fg={i() === ui.state.importProfileCursor ? theme.focus : theme.base} bg={i() === ui.state.importProfileCursor ? theme.surface0 : theme.base}>{i() === ui.state.importProfileCursor ? "> " : "  "}</S><S fg={theme.text} bg={i() === ui.state.importProfileCursor ? theme.surface0 : theme.base}>{item.name}</S><S fg={theme.overlay1} bg={i() === ui.state.importProfileCursor ? theme.surface0 : theme.base}>{`  ${item.account} · ${item.importPrefix || "no prefix"}`}</S></text>}</For></Show><text fg={theme.teal}>{ui.state.importProfileCursor === data.state.importProfiles.length ? "> New mapped profile" : "  New mapped profile"}</text></Modal></Show>
    <Show when={stage() === "profileEditor"}><Modal title="Map CSV profile" hints={`tab field · h/l choices · enter ${ui.state.importPath ? "save and scan" : "save"} · esc back`}><For each={profileFields()}>{(entry, i) => <text><S fg={i() === ui.state.importProfileField ? theme.focus : theme.subtext0} bold={i() === ui.state.importProfileField}>{i() === ui.state.importProfileField ? "> " : "  "}{entry[0]}: </S><S fg={theme.text}>{entry[1]}{i() === ui.state.importProfileField ? "▌" : ""}</S></text>}</For></Modal></Show>
    <Show when={stage() === "preview" && ui.state.importPreview}>{(p: () => NonNullable<typeof ui.state.importPreview>) => <Modal title="Import preview" hints="s skip duplicates · a force import · p all/dupes · r rules · esc cancel"><text fg={theme.subtext0}>{p().filename} · {p().accountName} · {p().profile.name}</text><text fg={theme.text}>Rows {p().rows.length} · <S fg={theme.success}>{p().newCount} new</S> · <S fg={theme.warning}>{p().duplicateCount} duplicates</S> · <S fg={p().errors.length ? theme.error : theme.success}>{p().errors.length} errors</S></text><Show when={p().errors.length}><For each={p().errors.slice(0, 4)}>{(err) => <text fg={theme.error}>{`line ${err.sourceLine}: ${err.message}`}</text>}</For><text fg={theme.error}>Import blocked until parsing errors are fixed.</text></Show><text fg={theme.subtext0}>{ui.state.importPreviewShowAll ? "All rows" : "Duplicate rows"} · rules {ui.state.importPreviewRules ? "ON" : "OFF"}</text><Show when={previewRows().length} fallback={<text fg={theme.overlay1}>No rows in this view.</text>}><For each={previewRows().slice(0, 8)}>{(row, i) => <text bg={i() === ui.state.importPreviewCursor ? theme.surface0 : theme.base}><S fg={row.duplicate ? theme.warning : theme.success} bg={i() === ui.state.importPreviewCursor ? theme.surface0 : theme.base}>{row.duplicate ? "! " : "· "}</S><S fg={theme.overlay1} bg={i() === ui.state.importPreviewCursor ? theme.surface0 : theme.base}>{row.dateISO} </S><S fg={theme.text} bg={i() === ui.state.importPreviewCursor ? theme.surface0 : theme.base}>{truncate(row.description, 38)}</S><S fg={theme.overlay1} bg={i() === ui.state.importPreviewCursor ? theme.surface0 : theme.base}>{`  ${row.amount.toFixed(2)}`}</S></text>}</For></Show></Modal>}</Show>
  </>
}

function FactoryResetOverlay() { return <Show when={ui.state.factoryResetOpen}><Modal title="Factory-reset database" tone="error" hints="enter erase · esc cancel"><text fg={theme.error}>Removes the SQLite database and its transaction, account, taxonomy, and rule data.</text><text fg={theme.overlay1}>Saved filters and import profiles remain in OpenTUI config.</text><text fg={theme.text}>Type RESET: {ui.state.factoryResetDraft}<S fg={theme.focus}>▌</S></text></Modal></Show> }

function EditorOverlay() {
  const ctx = () => ({ accounts: data.state.accounts, categories: data.state.categories, tags: data.state.tags, savedFilters: data.state.savedFilters })
  return (
    <Show when={ui.state.settingsEditor}>
      {(kind: () => NonNullable<typeof ui.state.settingsEditor>) => {
        const fields = () => editorFields(kind(), ui.state.settingsDraft, ctx())
        const cursor = () => Math.min(ui.state.settingsEditField, fields().length - 1)
        const field = () => fields()[cursor()]!
        // Sized to its content (border and padding: 4), and steady while
        // moving between fields: every kind's hint line counts.
        const hints = () => fields().map((f) => EDITOR_HINTS[f.kind]).reduce((a, b) => (b.length > a.length ? b : a), "")
        const width = () => 4 + editorWidth(fields(), editorNote(kind(), ui.state.settingsDraft), hints())
        return (
          <>
            <Modal
              title={kind() === "cycle" ? EDITOR_TITLE.cycle : `${ui.state.settingsEditId == null ? "New" : "Edit"} ${EDITOR_TITLE[kind()].toLowerCase()}`}
              width={width()}
              hints={EDITOR_HINTS[field().kind]}
            >
              <Form fields={fields()} cursor={cursor()} note={editorNote(kind(), ui.state.settingsDraft)} />
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
                  hints={field().multi ? "j/k move · enter toggle · esc done" : "j/k move · enter choose · esc back"}
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

function ConfirmOverlay() {
  const prompt = (confirm: NonNullable<typeof ui.state.settingsConfirm>) => confirm.kind === "clearData" ? "Clear all transaction and import data?" : confirm.kind === "clearAccount" ? `Clear transactions for ${confirm.label}?` : confirm.kind === "deleteAccount" ? `Remove ${confirm.label} and its transactions?` : confirm.kind === "budget" ? `Delete ${confirm.label}?` : confirm.kind === "desyncAccount" ? `Stop syncing ${confirm.label}? Its transactions are removed; switch sync back on to re-fetch them.` : `Delete ${confirm.label}?`
  return <Show when={ui.state.settingsConfirm}>{(confirm: () => NonNullable<typeof ui.state.settingsConfirm>) => <Modal title="Confirm" tone="error" width={64} hints="del confirm · esc cancel"><text fg={theme.text}>{prompt(confirm())}</text></Modal>}</Show>
}

export function SettingsTab(props: { focused: SectionId }) {
  const dims = useTerminalDimensions()
  const layout = () => dims().width >= 112 ? "wide" : dims().width >= 80 ? "medium" : "narrow"
  createEffect(() => {
    const visible = Math.max(1, Math.floor((dims().height - 10) / (layout() === "wide" ? 2 : 3)))
    if (ui.state.categoryVisible !== visible || ui.state.tagVisible !== visible) ui.setState({ categoryVisible: visible, tagVisible: visible })
  })
  const taxonomyFocused = () => props.focused === "set.categories" || props.focused === "set.tags"
  const databaseFocused = () => props.focused === "set.database"
  return <box width="100%" height="100%" flexDirection={layout() === "wide" ? "row" : "column"} gap={1} backgroundColor={theme.canvas}>
    <box width={layout() === "wide" ? "55%" : "100%"} flexShrink={layout() === "wide" ? 0 : 1} height="100%" flexDirection="column" gap={1}><TaxonomyPane focused={taxonomyFocused()} narrow={layout() === "narrow"} height={layout() === "wide" ? undefined : "45%"} /><BudgetsPane focused={props.focused === "set.budgets"} /><Show when={layout() !== "wide"}><RulesPane focused={props.focused === "set.rules"} /></Show><Show when={layout() === "narrow"}><FiltersPane focused={props.focused === "set.filters"} /></Show></box>
    <box flexGrow={1} flexShrink={1} minWidth={0} height="100%" flexDirection="column" gap={1}><Show when={layout() === "wide"}><RulesPane focused={props.focused === "set.rules"} /></Show><Show when={layout() !== "narrow"}><FiltersPane focused={props.focused === "set.filters"} /></Show><UpPane focused={props.focused === "set.up"} /><DatabasePane focused={databaseFocused()} /><ImportHistory /></box>
    <EditorOverlay />
    <ConfirmOverlay />
    <ImportOverlay />
    <FactoryResetOverlay />
  </box>
}
