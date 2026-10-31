import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { appToday } from "../../../domain/days"
import { merchantKey } from "../../../domain/history"
import { MERCHANT_SORTS, groupByMerchant, merchantFilter, sortMerchantGroups, type MerchantSort } from "../../../domain/merchants"
import { shortDate } from "../../../ui/text"
import { data, run, say } from "../../store"
import { CategoryLabel, Chips, Money } from "../../ui"
import "./merchants.css"

const LABELS: Record<MerchantSort, string> = { total: "Total", count: "#", merchant: "Merchant", last: "Last" }

export function Merchants(props: { onShowRows: () => void }) {
  let active = true
  onCleanup(() => { active = false })
  const [sort, setSort] = createSignal<MerchantSort>("total")
  const [reverse, setReverse] = createSignal(false)
  const [editing, setEditing] = createSignal<string | null>(null)
  const [draft, setDraft] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const groups = createMemo(() => sortMerchantGroups(groupByMerchant(data.scopedTransactions()), sort(), reverse()))
  const total = createMemo(() => groups().reduce((sum, group) => sum + group.total, 0))
  const options = createMemo(() => MERCHANT_SORTS.map((value) => ({
    value, label: `${LABELS[value]}${sort() === value ? (reverse() ? " ▲" : " ▼") : ""}`,
  })))

  function sortBy(value: MerchantSort) {
    if (value === sort()) setReverse(!reverse())
    else { setSort(value); setReverse(false) }
  }
  function showRows(name: string) {
    const onShowRows = props.onShowRows
    const result = data.commitFilter(merchantFilter(data.state.filterQuery, name))
    if (!result.ok) { say(result.err, true); return }
    onShowRows()
  }
  function editNote(name: string) {
    setDraft(data.state.merchantNotes[merchantKey(name)] ?? "")
    setEditing(name)
  }
  async function saveNote(name: string) {
    const note = draft().trim()
    setSaving(true)
    const result = await run(data.setMerchantNote(name, note), (count) => {
      if (!active) return
      return `${note ? "Note saved" : "Note removed"} · ${name}${count ? ` · re-suggested ${count} row${count === 1 ? "" : "s"}` : ""}`
    })
    if (!active) return
    setSaving(false)
    if (result !== undefined && editing() === name) setEditing(null)
  }
  const lastSeen = (iso: string) => iso.slice(0, 4) === appToday().slice(0, 4) ? shortDate(iso) : `${shortDate(iso)} ${iso.slice(2, 4)}`

  return (
    <div class="merch-view">
      <div class="merch-toolbar">
        <span class="small label">{groups().length.toLocaleString("en-AU")} merchant{groups().length === 1 ? "" : "s"}<span class="note"> · total </span><Money value={total()} class="figure" /></span>
        <Chips options={options()} value={sort()} onChange={sortBy} />
      </div>
      <div class="merch-list">
        <div class="merch-head small faint">
          <span>Merchant</span><span>Total</span><span>#</span><span>Average</span><span>Last</span><span>Category</span><span />
        </div>
        <For each={groups()} fallback={<div class="empty">No merchants.</div>}>{(group) => (
          <div class="merch-entry">
            <div class="merch-row">
              <button type="button" class="merch-name" onClick={() => showRows(group.merchant)}>{group.merchant}</button>
              <Money value={group.total} tone={group.total > 0} class="figure" />
              <span class="note mono">{group.count}</span>
              <Money value={group.average} class="label" />
              <span class="label small">{lastSeen(group.lastISO)}</span>
              <CategoryLabel name={group.categoryName} color={group.categoryColor} />
              <button type="button" class="btn ghost small" disabled={saving()} onClick={() => editNote(group.merchant)} aria-label={`Note on ${group.merchant}`}>note</button>
            </div>
            <Show when={data.state.merchantNotes[merchantKey(group.merchant)]}>{(note) => <div class="merch-note faint small">{note()}</div>}</Show>
            <Show when={editing() === group.merchant}>
              <div class="merch-editor">
                <textarea class="field" aria-label={`Note on ${group.merchant}`} disabled={saving()} value={draft()} onInput={(e) => setDraft(e.currentTarget.value)} />
                <div class="row"><button type="button" class="btn small" disabled={saving()} onClick={() => void saveNote(group.merchant)}>Save</button><button type="button" class="btn ghost small" disabled={saving()} onClick={() => setEditing(null)}>Cancel</button></div>
              </div>
            </Show>
          </div>
        )}</For>
      </div>
    </div>
  )
}
