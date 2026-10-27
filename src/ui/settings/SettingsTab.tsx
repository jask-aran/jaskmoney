import { armedFor } from "../../state/armed"
import { DATABASE_ROWS, databaseRow } from "../../state/databaseRows"
import { AI_ROWS } from "../../app/apiKeys"
import { AI_NAMES, aiActionHint, aiActions, aiConnection, aiContext, aiRow, aiStatus } from "../../state/aiDialog"
import { secretDisplay } from "../../state/settingsForm"
import { SignInBody } from "../primitives/SignInBody"
import { For, Show, createEffect, createMemo, onCleanup, type JSX } from "solid-js"
import type { ScrollBoxRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { SectionCard } from "../primitives/SectionCard"
import { muted } from "../primitives/spans"
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

function TaxonomyList(props: { kind: SettingsList; narrow?: boolean; split?: boolean }) {
  const categories = () => data.state.categories
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "taxonomy" && ui.state.taxonomyList === props.kind
  const rows = () => props.kind === "categories" ? categories() : data.state.tags
  const cursor = () => props.kind === "categories" ? ui.state.categoryCursor : ui.state.tagCursor
  const top = () => props.kind === "categories" ? ui.state.categoryTop : ui.state.tagTop
  const visible = () => props.kind === "categories" ? ui.state.categoryVisible : ui.state.tagVisible
  const title = () => `${props.kind === "categories" ? "Categories" : "Tags"} (${rows().length})`
  const windowRows = createMemo(() => rows().slice(top(), top() + visible()))

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
          const isCategory = () => props.kind === "categories"
          const scope = () => {
            if (!isCategory()) return (row as typeof data.state.tags[number]).scope ?? ""
            const category = row as typeof data.state.categories[number]
            return [category.isDefault ? "default" : "", category.notSpending ? "not spending" : ""].filter(Boolean).join(", ")
          }
          return <ListRow cursor={selected()} bg={theme.canvas} armed={armedFor(ui.state.armed, isCategory() ? "category" : "tag", row.id)} spans={[
            { text: `${isCategory() ? categoryMark(row.id) : "●"} `, fg: row.color },
            { text: truncate(row.name, props.narrow ? 28 : 20), fg: theme.text, bold: selected() },
            ...(scope() ? [{ text: ` (${scope()})`, fg: theme.overlay1 }] : []),
          ]} />
        }}</For>
      </Show></box>
      <box height={1}><ListFooter top={top()} visible={visible()} count={rows().length} /></box>
    </box>
  )
}

function BudgetsPane(props: { focused: boolean }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "budgets"
  const budgets = () => data.state.budgets
  return <SectionCard title={SETTINGS_SECTION_LABELS.budgets} focused={props.focused} active={active()} height={Math.max(1, budgets().length) + 4}>
    <ListRow cursor={active() && ui.state.budgetCursor === 0} bg={theme.canvas} spans={[{ text: "Cycle  ", fg: theme.subtext0 }, { text: describeCycle(data.state.budgetCycle), fg: theme.text }]} />
    <Show when={budgets().length} fallback={<text fg={theme.overlay1}>{active() ? "No budgets. Press a to add." : "No budgets. Activate to add."}</text>}>
      <For each={budgets()}>{(budget, i) => (
        <ListRow cursor={active() && ui.state.budgetCursor === i() + 1} bg={theme.canvas} armed={armedFor(ui.state.armed, "budget", budget.id)} spans={[
          { text: fit(budgetLabel(budget, data.state.accounts, data.state.categories), 34), fg: theme.text },
          { text: formatMoney(budget.amount).padStart(12), fg: theme.subtext1 },
        ]} />
      )}</For>
    </Show>
  </SectionCard>
}

function TaxonomyPane(props: { focused: boolean; narrow: boolean; height?: number | "auto" | `${number}%` }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "taxonomy"
  return <SectionCard title={SETTINGS_SECTION_LABELS.taxonomy} focused={props.focused} active={active()} height={props.height} flexGrow={props.height ? 0 : 1}>
    <Show when={props.narrow} fallback={<box width="100%" flexGrow={1} flexDirection="row" gap={2}><TaxonomyList kind="categories" split /><TaxonomyList kind="tags" split /></box>}>
      <TaxonomyList kind={ui.state.taxonomyList} narrow />
    </Show>
  </SectionCard>
}

function RulesPane(props: { focused: boolean; height?: number | "auto" | `${number}%` }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "rules"
  const rows = () => data.state.rules
  return <SectionCard title={SETTINGS_SECTION_LABELS.rules} focused={props.focused} active={active()} height={props.height} flexGrow={props.height ? 0 : 1} bottomSpans={[muted(rows().length ? count(rows().length, "ordered rule") : "empty")]}>
    <Show when={rows().length} fallback={<text fg={theme.overlay1}>{active() ? "No rules. Press a to add." : "No rules. Activate to add."}</text>}>
      <For each={rows()}>{(rule, i) => {
        const cat = () => data.state.categories.find((c) => c.id === rule.setCategoryId)?.name
        const tags = () => rule.addTagIds.map((id) => data.state.tags.find((t) => t.id === id)?.name).filter(Boolean).join(", ")
        const filter = () => data.state.savedFilters.find((filter) => filter.id === rule.savedFilterId)
        const healthy = createMemo(() => { const parsed = parseFilterStrict(filter()?.expr ?? ""); return !!parsed.node && !parsed.error })
        const appearance = () => ({ name: rule.enabled ? theme.text : theme.overlay1, filter: !rule.enabled ? theme.overlay1 : healthy() ? theme.subtext0 : theme.error, detail: !rule.enabled ? theme.overlay1 : healthy() ? theme.overlay1 : theme.error })
        return <ListRow id={`settings-rule-${i()}`} cursor={active() && ui.state.ruleCursor === i()} bg={theme.canvas} armed={armedFor(ui.state.armed, "rule", rule.id)} spans={[
          { text: `${i() + 1}. ${rule.name}  `, fg: appearance().name },
          { text: `filter:${rule.savedFilterId}`, fg: appearance().filter },
          { text: filter() ? ` (${filter()!.name})` : " (missing)", fg: appearance().detail },
          { text: ` → ${cat() ?? "—"}${tags() ? ` +${tags()}` : ""}`, fg: theme.overlay1 },
        ]} />
      }}</For>
    </Show>
  </SectionCard>
}

function FiltersPane(props: { focused: boolean; height?: number | "auto" | `${number}%` }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "filters"
  const rows = () => data.state.savedFilters
  return <SectionCard title={SETTINGS_SECTION_LABELS.filters} focused={props.focused} active={active()} height={props.height} flexGrow={props.height ? 0 : 1}>
    <Show when={rows().length} fallback={<text fg={theme.overlay1}>{active() ? "No saved filters. Press a to add." : "No saved filters. Activate to add."}</text>}>
      <For each={rows()}>{(filter, i) => (
        <ListRow id={`settings-filter-${i()}`} cursor={active() && ui.state.filterCursor === i()} bg={theme.canvas} armed={armedFor(ui.state.armed, "filter", filter.id)} spans={[
          { text: filter.id, fg: theme.teal },
          { text: `  ${truncate(filter.name, 16)}`, fg: theme.text },
          { text: `  ${truncate(filter.expr, 20)}`, fg: theme.overlay1 },
        ]} />
      )}</For>
    </Show>
  </SectionCard>
}

function DatabasePane(props: { focused: boolean; height?: number | "auto" | `${number}%` }) {
  const info = () => data.state.dbInfo
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "database"
  const counts = () => [
    `v${info()?.schemaVersion ?? "—"}`, count(info()?.transactionCount ?? 0, "txn"), count(info()?.accountCount ?? 0, "account"),
    `${info()?.categoryCount ?? 0} categor${info()?.categoryCount === 1 ? "y" : "ies"}`, count(info()?.tagCount ?? 0, "tag"), count(info()?.ruleCount ?? 0, "rule"), count(info()?.importCount ?? 0, "import"),
  ].join(" · ")
  const ctx = () => ({ icons: data.state.icons, weekStart: data.state.weekStart, xAxis: !!data.state.uiPrefs.xAxis, profiles: data.state.importProfiles.length })
  const summary = () => (["icons", "weekStart", "xAxis"] as const).map((row) => { const view = databaseRow(row, ctx()); return `${view.label} ${view.value}` }).join(" · ")
  // Fixed height: the counts and, while active, a row per action (else a
  // line of the settings), so a tight column shrinks the panes that scroll.
  return <SectionCard title={SETTINGS_SECTION_LABELS.database} focused={props.focused} active={active()} height={props.height ?? (active() ? DATABASE_ROWS.length + 3 : 4)} flexGrow={0}>
    <text fg={theme.overlay1} wrapMode="none">{counts()}</text>
    <Show when={active()} fallback={<text fg={theme.subtext0} wrapMode="none">{summary()}</text>}>
    <For each={DATABASE_ROWS}>{(row, i) => {
      const view = () => databaseRow(row, ctx())
      return <ListRow cursor={active() && ui.state.databaseCursor === i()} bg={theme.canvas} armed={row === "clearData" ? armedFor(ui.state.armed, "clearData", 0) : undefined} spans={[
        { text: view().value != null ? fit(view().label, 20) : view().label, fg: view().danger ? theme.error : theme.text },
        ...(view().value != null ? [{ text: view().value!, fg: theme.subtext1 }] : []),
      ]} />
    }}</For>
    </Show>
  </SectionCard>
}

/** Up Bank sync: status plus one row per Up account with its sync switch.
 * Token presence is read from the environment (Bun loads .env); the value is
 * never rendered. */
function UpPane(props: { focused: boolean; width?: `${number}%` }) {
  const info = () => data.state.dbInfo
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "up"
  const connection = () => aiConnection("up", aiContext(data))
  const accounts = () => data.state.syncAccounts
  const syncNote = () => data.state.upSyncing ? "syncing…"
    : info()?.upLastSyncedAt ? `last sync ${new Date(info()!.upLastSyncedAt!).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}`
    : "not synced yet"
  return <SectionCard title={SETTINGS_SECTION_LABELS.up} focused={props.focused} active={active()} height={Math.max(1, accounts().length) + 4} width={props.width}>
    {/* The token first: enter opens its dialog (enter, test, remove). */}
    <ListRow cursor={active() && ui.state.upCursor === 0} bg={theme.canvas} spans={connection() ? [
      { text: fit("Token", 16), fg: theme.text },
      { text: fit(connection()!.short, 22), fg: theme.success },
      { text: syncNote(), fg: data.state.upSyncing ? theme.peach : theme.overlay1 },
    ] : [
      { text: fit("Token", 16), fg: theme.text },
      { text: "not set · enter to add one to sync", fg: theme.warning },
    ]} />
    <Show when={info()?.upLastError}>{(error: () => string) => <text fg={theme.error} wrapMode="none">{error()}</text>}</Show>
    <Show when={accounts().length} fallback={<text fg={theme.overlay1}>No accounts synced yet</text>}>
      <For each={accounts()}>{(account, i) => {
        const on = () => account.syncEnabled
        return <ListRow cursor={active() && ui.state.upCursor === i() + 1} bg={theme.canvas} armed={armedFor(ui.state.armed, "desyncAccount", account.id)} spans={[
          { text: fit(account.name, 16), fg: on() ? theme.text : theme.overlay1 },
          { text: fit(accountRole(account) === "saver" ? "saver" : "spending", 10), fg: theme.overlay1 },
          { text: fit(account.balance != null ? formatMoney(account.balance) : "—", 12), fg: on() ? theme.subtext1 : theme.overlay1 },
          { text: on() ? "● sync on" : "○ sync off", fg: on() ? theme.success : theme.overlay1 },
        ]} />
      }}</For>
    </Show>
  </SectionCard>
}

/** AI models: one compact row per model (what, how it's connected, what
 * for); enter opens its dialog (AiDialog), where everything else is. */
function AiPane(props: { focused: boolean; width?: `${number}%` }) {
  const active = () => ui.state.settingsActive && ui.state.settingsSection === "ai"
  const rows = () => {
    const ctx = aiContext(data)
    return AI_ROWS.map((row) => aiRow(row, ctx))
  }
  return <SectionCard title={SETTINGS_SECTION_LABELS.ai} focused={props.focused} active={active()} height={AI_ROWS.length + 2} width={props.width}>
    <For each={rows()}>{(row, i) => (
      <ListRow cursor={active() && ui.state.aiCursor === i()} bg={theme.canvas} spans={[
        { text: row.connected ? "● " : "○ ", fg: row.connected ? theme.success : theme.overlay1 },
        { text: row.name.padEnd(12), fg: theme.text },
        { text: row.how.padEnd(13), fg: row.connected ? theme.subtext0 : theme.overlay1 },
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

function ImportHistory(props: { height?: number | "auto" | `${number}%` }) {
  return <SectionCard title="Import History" height={props.height} flexGrow={props.height ? 0 : 1}>
    <Show when={data.state.imports.length} fallback={<text fg={theme.overlay1}>No imports yet.</text>}>
      <For each={data.state.imports.slice(0, 4)}>{(item) => <text><S fg={theme.text}>{truncate(item.filename, 24)}</S><S fg={theme.overlay1}>{`  ${item.rowCount} rows  ${item.importedAt}`}</S></text>}</For>
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
const paneId = (section: SectionId) => `settings-pane-${section === "set.tags" ? "set.categories" : section}`

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
  const Column = (column: { width?: `${number}%`; children: JSX.Element }) => (
    <scrollbox ref={(box: ScrollBoxRenderable) => {
      columns.push(box)
      onCleanup(() => columns.splice(columns.indexOf(box), 1))
      // A first layout or a resize moves the panes: follow focus again,
      // after the scrollbox's own handler (it updates the scroll range).
      const own = box.content.onSizeChange
      box.content.onSizeChange = () => { own?.call(box.content); box.scrollChildIntoView(paneId(props.focused)) }
    }}
      width={column.width} flexGrow={column.width ? 0 : 1} flexShrink={column.width ? 0 : 1} minWidth={0} height="100%"
      scrollY scrollX={false} focusable={false} verticalScrollbarOptions={{ visible: false }} contentOptions={{ flexDirection: "column", gap: 1 }}>
      {column.children}
    </scrollbox>
  )
  const Pane = (pane: { section: SectionId; children: JSX.Element }) => <box id={paneId(pane.section)} width="100%" flexShrink={0}>{pane.children}</box>
  const taxonomy = () => <Pane section="set.categories"><TaxonomyPane focused={taxonomyFocused()} narrow={layout() === "narrow"} height={rows() + 4} /></Pane>
  const budgets = () => <Pane section="set.budgets"><BudgetsPane focused={props.focused === "set.budgets"} /></Pane>
  const rules = () => <Pane section="set.rules"><RulesPane focused={props.focused === "set.rules"} /></Pane>
  const filters = () => <Pane section="set.filters"><FiltersPane focused={props.focused === "set.filters"} /></Pane>
  const database = () => <Pane section="set.database"><DatabasePane focused={props.focused === "set.database"} /></Pane>
  const history = () => <box width="100%" flexShrink={0}><ImportHistory /></box>
  return <box width="100%" height="100%" flexDirection="row" gap={1} backgroundColor={theme.canvas}>
    <Show when={layout() === "wide"} fallback={
      <Column>
        {taxonomy()}{budgets()}{rules()}{filters()}
        <Show when={layout() === "medium"} fallback={<>
          <Pane section="set.up"><UpPane focused={props.focused === "set.up"} /></Pane>
          <Pane section="set.ai"><AiPane focused={props.focused === "set.ai"} /></Pane>
        </>}>
          <box flexDirection="row" gap={1} width="100%" flexShrink={0}>
            <box id={paneId("set.up")} width="50%"><UpPane focused={props.focused === "set.up"} /></box>
            <box id={paneId("set.ai")} flexGrow={1} minWidth={0}><AiPane focused={props.focused === "set.ai"} /></box>
          </box>
        </Show>
        {database()}{history()}
      </Column>
    }>
      <Column width="55%">{taxonomy()}{budgets()}<Pane section="set.ai"><AiPane focused={props.focused === "set.ai"} /></Pane></Column>
      <Column>{rules()}{filters()}<Pane section="set.up"><UpPane focused={props.focused === "set.up"} /></Pane>{database()}{history()}</Column>
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
