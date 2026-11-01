import { APPEARANCE_ROWS, appearanceRow } from "../../../state/appearanceRows"
/**
 * Settings' other panes, as the TUI's: Up Bank (the token, sync, which
 * accounts sync), AI models (read-only here: keys and sign-ins are set in
 * the TUI), Rules and Saved filters, and the Database. The token and keys
 * are never shown or sent: the core says only whether one is set, and its
 * mask.
 */
import { For, Show, createMemo } from "solid-js"
import { parseFilterStrict } from "../../../domain/filter"
import { accountRole, type Account, type Rule, type SavedFilter } from "../../../domain/types"
import { connection as link, data, lostReason, run, say, setTab, syncLabel } from "../../store"
import {
  Button, Icons, SettingColumn, SettingColumns, SettingDetails, SettingGroup, SettingLine, SettingNote, SettingValue, StatusDot, Switch,
} from "../../v2"
import { AI_NAMES, MODEL_ROWS, USES, connection, useModel } from "./ai"
import { appState, applyUpdate, build, builtLabel, checkForUpdate, reloadFromServer } from "../../pwa"
import { confirmTwice, isArmed } from "./confirm"

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-AU")} ${n === 1 ? one : many}`

/** Set or not: a live dot beside how, or "not set". */
function Connected(props: { how: string | null | undefined; unset: string }) {
  return (
    <SettingValue>
      <span class="st-conn">
        <StatusDot label={props.how ? "connected" : "not connected"} tone={props.how ? "success" : "muted"} />
        <span>{props.how ?? props.unset}</span>
      </span>
    </SettingValue>
  )
}

const synced = syncLabel
const canSync = () => !data.state.upSyncing && !data.state.demo && !!data.state.upToken
const sync = () => { say("Syncing with Up…"); void run(data.syncUp()) }
const syncTitle = () => (data.state.demo ? "Sync is off in demo mode" : data.state.upToken ? "Sync with Up now" : "The core has no Up token")

/** A phone's sidebar foot: the connection to the core, and Up's sync with Sync now. */
export function Status() {
  const state = () => link()
  return (
    <SettingGroup title="Status">
      <SettingLine plain label="Connection" title={state() === "lost" ? lostReason() : "Live: a change from any client shows at once"}>
        <SettingValue>
          <span class="st-conn">
            <StatusDot label={state()} tone={state() === "open" ? "success" : state() === "lost" ? "danger" : "muted"} />
            <span>{state() === "open" ? "live" : state() === "lost" ? "reconnecting…" : "connecting…"}</span>
          </span>
        </SettingValue>
      </SettingLine>
      <Show when={state() === "lost"}><SettingNote tone="error">{lostReason()}</SettingNote></Show>
      <SettingLine plain label="Up Bank" state={data.state.demo ? "demo data" : data.state.upToken ? synced() : "no Up token"}>
        <Button variant="secondary" size="sm" disabled={!canSync()} onClick={sync} title={syncTitle()}><Icons.Refresh />Sync now</Button>
      </SettingLine>
      <Show when={data.state.dbInfo?.upLastError}>{(error) => <SettingNote tone="error">{error()}</SettingNote>}</Show>
    </SettingGroup>
  )
}

/** Up Bank: the token (set in the TUI), sync (unless Status has it), and which accounts sync. */
export function UpBank(props: { sync?: boolean }) {
  const token = createMemo(() => connection("up", data.state))
  const accounts = () => data.state.syncAccounts
  const off = () => accounts().filter((a) => !a.syncEnabled)
  const linked = () => {
    if (!accounts().length) return "none yet · they appear after a sync"
    const syncing = `${accounts().length - off().length} of ${accounts().length} syncing`
    return off().length ? `${syncing} · ${off().map((a) => a.name).join(", ")} off` : syncing
  }
  const flip = (account: Account) => {
    // Switching off deletes the account's transactions: two presses.
    if (account.syncEnabled) {
      confirmTwice(`desync:${account.id}`, `stop syncing ${account.name} (its transactions are removed)`, () =>
        void run(data.setAccountSync(account.id, false), (n) => `Sync off for ${account.name} · ${n ?? 0} transactions removed`))
      return
    }
    void run(data.setAccountSync(account.id, true), () => `Sync on for ${account.name} · Sync now brings its transactions back`)
  }
  return (
    <SettingGroup title="Up Bank">
      <SettingLine plain label="Token" title={token()?.long}><Connected how={token()?.short} unset="not set · add it in the TUI" /></SettingLine>
      <Show when={props.sync !== false}>
        <SettingLine plain label="Sync" state={token() ? synced() : "needs the token"}>
          <Button variant="ghost" size="sm" disabled={!canSync()} onClick={sync} title={syncTitle()}><Icons.Refresh />Sync now</Button>
        </SettingLine>
        <Show when={data.state.dbInfo?.upLastError}>{(error) => <SettingNote tone="error">{error()}</SettingNote>}</Show>
      </Show>
      <SettingLine plain label="Accounts" title={linked()}><SettingValue>{linked()}</SettingValue></SettingLine>
      <For each={accounts()}>{(account) => {
        const key = `desync:${account.id}`
        return (
          <SettingLine plain label={<span class="st-account" data-off={account.syncEnabled ? undefined : ""}>{account.name}</span>}
            state={isArmed(key) ? <span class="st-armed">press again: removes its transactions</span> : accountRole(account) === "saver" ? "saver" : "spending"}>
            <span data-arm={key} class="st-arm">
              <Switch label={account.syncEnabled ? `Stop syncing ${account.name}` : `Sync ${account.name}`} checked={account.syncEnabled} onChange={() => flip(account)} />
            </span>
          </SettingLine>
        )
      }}</For>
      <SettingNote>Switching an account off removes its transactions here (press twice); on brings them back at the next sync.</SettingNote>
    </SettingGroup>
  )
}

/** AI models: how each is connected, and the model doing each use. Read-only. */
export function AiModels() {
  return (
    <SettingGroup title="AI models">
      <SettingColumns>
        <SettingColumn title="Models">
          <For each={MODEL_ROWS}>{(row) => {
            const link = () => connection(row, data.state)
            return (
              <SettingLine plain label={AI_NAMES[row].name} state={AI_NAMES[row].by} title={`${AI_NAMES[row].name}: ${link()?.long ?? "not set"}`}>
                <Connected how={link()?.short} unset="not set" />
              </SettingLine>
            )
          }}</For>
        </SettingColumn>
        <SettingColumn title="Uses">
          <For each={USES}>{(use) => {
            const model = () => useModel(use.id, data.state)
            return (
              <SettingLine plain label={use.name} title={model().text}>
                <SettingValue><span class="st-model" data-ready={model().ready ? "" : undefined}>{model().text}</span></SettingValue>
              </SettingLine>
            )
          }}</For>
        </SettingColumn>
      </SettingColumns>
      <SettingDetails summary="How each is connected">
        <dl class="st-facts">
          <For each={MODEL_ROWS}>{(row) => <><dt>{AI_NAMES[row].name}</dt><dd>{connection(row, data.state)?.long ?? "not set"} · {AI_NAMES[row].uses}</dd></>}</For>
        </dl>
      </SettingDetails>
      <SettingNote>Keys and sign-ins are set in the TUI (Settings › AI models).</SettingNote>
    </SettingGroup>
  )
}

/** A saved filter on the Transactions tab (the TUI's applySavedFilter): its use recorded. */
function showFilter(filter: SavedFilter): void {
  const result = data.commitFilter(filter.expr)
  if (!result.ok) { say(result.err, true); return }
  setTab("transactions")
  void run(data.recordFilterUsage(filter.id), () => `Filter: ${filter.name}`)
}

function RuleLine(props: { rule: Rule; index: number; last: number }) {
  const rule = () => props.rule
  const category = () => data.state.categories.find((c) => c.id === rule().setCategoryId)?.name
  const tags = () => rule().addTagIds.map((id) => data.state.tags.find((t) => t.id === id)?.name).filter(Boolean).map((name) => `+${name}`).join(" ")
  const filter = () => data.state.savedFilters.find((f) => f.id === rule().savedFilterId)
  const healthy = createMemo(() => { const parsed = parseFilterStrict(filter()?.expr ?? ""); return !!parsed.node && !parsed.error })
  const on = () => rule().enabled
  const matches = () => (!filter() ? `missing filter ${rule().savedFilterId}` : healthy() ? `filter:${rule().savedFilterId}` : `broken filter:${rule().savedFilterId}`)
  const sets = () => [category() ? `→ ${category()}` : "", tags()].filter(Boolean).join(" ") || "→ nothing"
  const key = () => `rule:${rule().id}`
  const toggle = () => { const next = !on(); void run(data.toggleSettingsRule(rule().id, next), () => `${rule().name} ${next ? "on" : "off"}`) }
  const move = (to: number) => void run(data.reorderSettingsRule(rule().id, to))
  const remove = () => confirmTwice(key(), `delete ${rule().name}`, () => void run(data.deleteSettingsRule(rule().id), () => `Deleted ${rule().name}`))
  return (
    <SettingLine plain title={`${rule().name}: ${sets()} · ${matches()}${filter() ? `\n${filter()!.expr}` : ""}`}
      label={<span class="st-rule" data-off={on() ? undefined : ""}><span class="st-num">{props.index + 1}</span>{rule().name}{on() ? "" : " (off)"}</span>}
      state={sets()}>
      <Button variant="ghost" size="sm" class="st-filter-link" data-broken={on() && !(filter() && healthy()) ? "" : undefined} disabled={!filter()}
        title={filter() ? "Show its rows in Transactions" : undefined} onClick={() => filter() && showFilter(filter()!)}>{matches()}</Button>
      <Switch label={on() ? `Switch ${rule().name} off` : `Switch ${rule().name} on`} checked={on()} onChange={toggle} />
      <Button variant="ghost" size="icon-xs" aria-label="Move up" title="Move up (a later rule wins)" disabled={props.index === 0} onClick={() => move(props.index - 1)}><Icons.ArrowUp /></Button>
      <Button variant="ghost" size="icon-xs" aria-label="Move down" title="Move down" disabled={props.index === props.last} onClick={() => move(props.index + 1)}><Icons.ArrowDown /></Button>
      <span data-arm={key()} class="st-arm">
        <Show when={isArmed(key())} fallback={
          <Button variant="ghost" size="icon-xs" aria-label={`Delete ${rule().name}`} title={`Delete ${rule().name}`} onClick={remove}><Icons.Delete /></Button>
        }>
          <Button variant="destructive" size="sm" onClick={remove}>Press again</Button>
        </Show>
      </span>
    </SettingLine>
  )
}

/** Rules (ordered, last match wins), then the saved filters they match. */
export function RulesFilters() {
  const rules = () => data.state.rules
  const filters = () => data.state.savedFilters
  return (
    <>
      <SettingGroup title={`Rules ${rules().length}${rules().length > 1 ? " · last match wins" : ""}`}>
        <For each={rules()} fallback={<SettingNote>No rules yet.</SettingNote>}>{(rule, i) => <RuleLine rule={rule} index={i()} last={rules().length - 1} />}</For>
      </SettingGroup>
      <SettingGroup title={`Saved filters ${filters().length}`}>
        <For each={filters()} fallback={<SettingNote>No saved filters yet.</SettingNote>}>{(filter) => (
          <SettingLine plain label={filter.name} state={`filter:${filter.id}`} title={filter.expr}>
            <SettingValue mono>{filter.expr}</SettingValue>
            <Button variant="ghost" size="sm" title="Show its rows in Transactions" onClick={() => showFilter(filter)}>Show</Button>
          </SettingLine>
        )}</For>
      </SettingGroup>
    </>
  )
}

/** Display preferences are shown here and changed in the TUI. */
export function Appearance() {
  const ctx = () => ({ ...data.state.uiPrefs, icons: data.state.icons })
  return <SettingGroup title="Appearance">
    <For each={APPEARANCE_ROWS}>{(row) => {
      const view = () => appearanceRow(row, ctx())
      return <SettingLine plain label={view().label}><SettingValue>{view().value}</SettingValue></SettingLine>
    }}</For>
    <SettingNote>Change appearance in the TUI.</SettingNote>
  </SettingGroup>
}

/** The database: where it is, what it holds, and its settings (shown, not changed here). */
export function Database() {
  const info = () => data.state.dbInfo
  // The home directory as ~, as the TUI shows it.
  const where = () => `${data.state.dbPath.replace(/^\/(home|Users)\/[^/]+(?=\/)/, "~")} · schema v${info()?.schemaVersion ?? "—"}`
  const holds = () => [
    count(info()?.transactionCount ?? 0, "transaction"), count(info()?.accountCount ?? 0, "account"),
    count(info()?.categoryCount ?? 0, "category", "categories"), count(info()?.tagCount ?? 0, "tag"), count(info()?.ruleCount ?? 0, "rule"),
  ].join(" · ")
  return (
    <SettingGroup title="Database">
      <SettingLine plain label="Path" title={where()}><SettingValue mono><span class="st-wrap">{where()}</span></SettingValue></SettingLine>
      <SettingLine plain label="Holds" title={holds()}><SettingValue><span class="st-wrap">{holds()}</span></SettingValue></SettingLine>
      <SettingLine plain label="Weeks start on"><SettingValue>{data.state.weekStart === "sunday" ? "Sunday" : "Monday"}</SettingValue></SettingLine>
      <SettingLine plain label="Demo mode"><SettingValue>{data.state.demo ? "on · from your spending, scrambled" : "off"}</SettingValue></SettingLine>
      <SettingNote>Importing, demo mode, clearing and resetting are in the TUI.</SettingNote>
    </SettingGroup>
  )
}

/**
 * The app: which build this is, and (installed on a home screen) its updates. The installed app stays on the
 * build it has until Update; a browser tab loads the newest build each visit (web/pwa.ts).
 */
export function App() {
  const version = () => (build ? `${build.version} · ${builtLabel(build.built)}` : "—")
  const status = () => {
    const now = appState()
    switch (now.kind) {
      case "browser": return "a browser tab: the newest build each visit"
      case "unsupported": return "can't update itself here (needs https)"
      case "starting": return "starting…"
      case "current": return "up to date"
      case "checking": return "checking…"
      case "downloading": return "downloading the update…"
      case "ready": return now.next ? `update ready · ${now.next.version} · ${builtLabel(now.next.built)}` : "update ready"
      case "failed": return "couldn't check"
    }
  }
  const kind = () => appState().kind
  return (
    <SettingGroup title="App">
      <SettingLine plain label="Build"><SettingValue mono>{version()}</SettingValue></SettingLine>
      <SettingLine plain label="Updates" state={status()}>
        <Show when={kind() === "ready"} fallback={
          <Show when={kind() !== "browser" && kind() !== "unsupported"}>
            <Button variant="secondary" size="sm" disabled={kind() === "checking" || kind() === "downloading" || kind() === "starting"} onClick={() => void checkForUpdate()}><Icons.Refresh />Check</Button>
          </Show>
        }>
          <Button size="sm" onClick={applyUpdate}>Update</Button>
        </Show>
      </SettingLine>
      <Show when={appState().kind === "failed" ? (appState() as { why: string }).why : null}>{(why) => <SettingNote tone="error">{why()}</SettingNote>}</Show>
      <Show when={kind() !== "browser"}>
        <SettingLine plain label="Load from the server" state="to sign in again" title="Loads the page from the server, past the kept build: to sign in again, or if this build won't start">
          <Button variant="ghost" size="sm" onClick={reloadFromServer}>Reload</Button>
        </SettingLine>
      </Show>
    </SettingGroup>
  )
}
