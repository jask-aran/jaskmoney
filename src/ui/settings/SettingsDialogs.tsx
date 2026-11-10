import { armedFor, isArmed } from "../../state/armed"
import { For, Show, createMemo, createEffect } from "solid-js"
import type { UiState } from "../../state/uiStore"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { ink, theme, tone } from "../../theme"
import { fit, count } from "../text"
import { accountRole } from "../../domain/types"
import { Modal } from "../primitives/Modal"
import { ListRow, centredTop, windowLabel } from "../primitives/ListRow"
import { AI_NAMES, aiActionHint, aiActions, aiConnection, aiContext, aiStatus } from "../../state/aiDialog"
import { secretDisplay, EDITOR_TITLE, editorFields, editorNote, editorWidth, pickerItems, type FormField } from "../../state/settingsForm"
import { SignInBody } from "../primitives/SignInBody"
import { CardColumn, CardSides, actionLine, blank, labelled, noteLines, numbered, usesLines, wrapped, type CardLine } from "../primitives/cardLines"
import { AI_USES_TEXT, UP_TOKEN_STEPS, UP_USES, type IntegrationUse } from "../../state/integrationUses"
import { useTerminalDimensions } from "@opentui/solid"
import { S } from "../primitives/S"
import { TextInput } from "../primitives/TextInput"
import { IMPORT_HISTORY_ROWS } from "../../state/databaseRows"
import { formatMoney } from "../../domain/dashboard"
import { categoryMark } from "../icons"
import { Form } from "../primitives/Form"
import { ListPicker } from "../primitives/ListPicker"

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
export function ImportHistoryDialog() {
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

export function ImportOverlay() {
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

export function FactoryResetOverlay() { return <Show when={ui.state.factoryReset !== null}><Modal title="Factory-reset database" tone="error" hints="enter erase · esc cancel"><text fg={tone.bad}>Removes the SQLite database and its transaction, account, taxonomy, and rule data.</text><text fg={ink.note}>Saved filters and import profiles stay in settings.json.</text><text fg={tone.bad}>Type RESET: <TextInput field={{ value: ui.state.factoryReset!.draft, caret: ui.state.factoryReset!.caret }} focused /></text></Modal></Show> }

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
