/**
 * Settings' other panes, as the TUI's: Up Bank (the token, sync, which
 * accounts sync), AI models (read-only here: keys and sign-ins are set in
 * the TUI), Rules & Filters, and the Database. The token and keys are never
 * shown or sent: the core says only whether one is set, and its mask.
 */
import { For, Show, createMemo, createSignal } from "solid-js"
import { syncAgo } from "../../../domain/days"
import { parseFilterStrict } from "../../../domain/filter"
import { accountRole, type Account, type Rule, type SavedFilter } from "../../../domain/types"
import { data, now, run, say, setTab } from "../../store"
import { AI_NAMES, MODEL_ROWS, USES, connection, useModel, type ModelRow } from "./ai"
import { confirmTwice, isArmed } from "./confirm"
import { Group, Line, Switch } from "./lines"

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-AU")} ${n === 1 ? one : many}`

/** Up Bank: the token (set in the TUI), sync, and which accounts sync. */
export function UpBank() {
  const token = createMemo(() => connection("up", data.state))
  const accounts = () => data.state.syncAccounts
  const off = () => accounts().filter((a) => !a.syncEnabled)
  const synced = () => {
    if (data.state.upSyncing) return "syncing…"
    const ago = syncAgo(data.state.dbInfo?.upLastSyncedAt ?? null, now())
    return ago ? `synced ${ago}` : "not synced yet"
  }
  const linked = () => {
    if (!accounts().length) return "none yet · they appear after a sync"
    const syncing = `${accounts().length - off().length} of ${accounts().length} syncing`
    return off().length ? `${syncing} · ${off().map((a) => a.name).join(", ")} off` : syncing
  }
  const canSync = () => !data.state.upSyncing && !data.state.demo && data.state.upToken
  const sync = () => { say("Syncing with Up…"); void run(data.syncUp()) }
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
    <Group title="Up Bank" note="Switching an account off removes its transactions here (press twice); on brings them back at the next sync.">
      <Line field label="Token" title={token()?.long} value={<span classList={{ good: !!token(), faint: !token() }}>{token()?.short ?? "not set · add it in the TUI"}</span>} />
      <Line field label="Sync" value={token() ? synced() : "needs the token"}
        control={<button type="button" class="btn small ghost" disabled={!canSync()} onClick={sync}
          title={data.state.demo ? "Sync is off in demo mode" : data.state.upToken ? "Sync with Up now" : "The core has no Up token"}>Sync now</button>} />
      <Show when={data.state.dbInfo?.upLastError}>{(error) => <Line field label="Last error" value={<span class="bad">{error()}</span>} wrap />}</Show>
      <Line field label="Accounts" value={linked()} wrap />
      <For each={accounts()}>{(account) => {
        const key = `desync:${account.id}`
        return (
          <Line indent muted={!account.syncEnabled} label={account.name} meta={accountRole(account) === "saver" ? "saver" : "spending"}
            value={isArmed(key) ? <span class="bad">press again: removes its transactions</span> : undefined}
            control={<Switch on={account.syncEnabled} danger={isArmed(key)} arm={key} label={account.syncEnabled ? `Stop syncing ${account.name}` : `Sync ${account.name}`} onClick={() => flip(account)} />} />
        )
      }}</For>
    </Group>
  )
}

/** AI models: how each is connected, and the model doing each use. Read-only. */
export function AiModels() {
  const [open, setOpen] = createSignal<ModelRow | null>(null)
  return (
    <Group title="AI models" note="Keys and sign-ins are set in the TUI (Settings › AI models).">
      <h3 class="st-sub">Models</h3>
      <For each={MODEL_ROWS}>{(row) => {
        const link = () => connection(row, data.state)
        return (
          <>
            <Line onClick={() => setOpen(open() === row ? null : row)} title={`${AI_NAMES[row].name}: ${link()?.long ?? "not set"}`}
              lead={<span classList={{ good: !!link(), faint: !link() }}>{link() ? "●" : "○"}</span>}
              label={AI_NAMES[row].name} meta={AI_NAMES[row].by}
              value={<span classList={{ label: !!link(), note: !link() }}>{link()?.short ?? "not set"}</span>} />
            <Show when={open() === row}>
              <Line indent field label="Connection" value={link()?.long ?? "not set"} wrap />
              <Line indent field label="Used for" value={AI_NAMES[row].uses} wrap />
            </Show>
          </>
        )
      }}</For>
      <h3 class="st-sub">Uses</h3>
      <For each={USES}>{(use) => {
        const model = () => useModel(use.id, data.state)
        return <Line label={use.name} value={<span classList={{ ai: model().ready, faint: !model().ready }}>{model().text}</span>} />
      }}</For>
    </Group>
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
    <Line stack muted={!on()} title={`${rule().name}: ${sets()} · ${matches()}${filter() ? `\n${filter()!.expr}` : ""}`}
      lead={<span class="mono note">{props.index + 1}</span>}
      label={`${rule().name}${on() ? "" : " (off)"}`}
      meta={sets()}
      value={
        <button type="button" class="st-link mono" classList={{ faint: !on(), bad: on() && !(filter() && healthy()) }}
          disabled={!filter()} title={filter() ? "Show its rows in Transactions" : undefined} onClick={() => filter() && showFilter(filter()!)}>{matches()}</button>
      }
      control={
        <>
          <Switch on={on()} label={on() ? `Switch ${rule().name} off` : `Switch ${rule().name} on`} onClick={toggle} />
          <button type="button" class="btn small ghost" aria-label="Move up" title="Move up (the first match wins)" disabled={props.index === 0} onClick={() => move(props.index - 1)}>↑</button>
          <button type="button" class="btn small ghost" aria-label="Move down" title="Move down" disabled={props.index === props.last} onClick={() => move(props.index + 1)}>↓</button>
          <button type="button" class="btn small ghost st-delete" classList={{ armed: isArmed(key()) }} data-arm={key()} aria-label={`Delete ${rule().name}`} title={`Delete ${rule().name}`} onClick={remove}>
            {isArmed(key()) ? "Press again to delete" : "✕"}
          </button>
        </>
      } />
  )
}

/** Rules (ordered, first match wins), then the saved filters they match. */
export function RulesFilters() {
  const rules = () => data.state.rules
  const filters = () => data.state.savedFilters
  return (
    <>
      <Group title="Rules" count={`${rules().length}${rules().length > 1 ? " · first match wins" : ""}`}>
        <For each={rules()} fallback={<div class="st-none">No rules yet.</div>}>{(rule, i) => <RuleLine rule={rule} index={i()} last={rules().length - 1} />}</For>
      </Group>
      <Group title="Saved filters" count={filters().length}>
        <For each={filters()} fallback={<div class="st-none">No saved filters yet.</div>}>{(filter) => (
          <Line stack onClick={() => showFilter(filter)} title={`Show in Transactions: ${filter.expr}`}
            label={filter.name} meta={<span class="mono">filter:{filter.id}</span>} value={<span class="mono">{filter.expr}</span>} />
        )}</For>
      </Group>
    </>
  )
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
    <Group title="Database" note="Importing, demo mode, clearing and resetting are in the TUI.">
      <Line field label="Path" value={<span class="mono">{where()}</span>} stack />
      <Line field label="Holds" value={holds()} stack />
      <Line field label="Weeks start on" value={data.state.weekStart === "sunday" ? "Sunday" : "Monday"} />
      <Line field label="Demo mode" value={<span classList={{ caution: data.state.demo }}>{data.state.demo ? "on · from your spending, scrambled" : "off"}</span>} />
    </Group>
  )
}
