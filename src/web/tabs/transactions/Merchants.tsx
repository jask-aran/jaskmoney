import { NotebookPen } from "lucide-solid"
import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { appToday } from "../../../domain/days"
import { merchantKey } from "../../../domain/history"
import { MERCHANT_SORTS, groupByMerchant, merchantFilter, sortMerchantGroups, type MerchantSort } from "../../../domain/merchants"
import { shortDate } from "../../../ui/text"
import { data, run, say } from "../../store"
import { CategoryLabel, Chips, Empty, Money } from "../../ui"
import { Button, TextArea } from "../../v2"
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
        <span on:click={{ capture: true, handleEvent: (event) => {
          // Segmented skips its current choice; pressing it still reverses this sort.
          if (event.target instanceof Element && event.target.closest('button[aria-checked="true"]')) sortBy(sort())
        } }}><Chips options={options()} value={sort()} onChange={sortBy} /></span>
      </div>
      <div class="merch-list">
        <div class="merch-head">
          <span>Merchant</span><span>Total</span><span>#</span><span>Average</span><span>Last</span><span>Category</span><span />
        </div>
        <For each={groups()} fallback={<Empty>No merchants.</Empty>}>{(group) => (
          <div>
            <div class="merch-row">
              <button type="button" class="merch-name" onClick={() => showRows(group.merchant)}>{group.merchant}</button>
              <Money value={group.total} tone={group.total > 0} class="figure" />
              <span class="note mono">{group.count}</span>
              <Money value={group.average} class="label" />
              <span class="label small">{lastSeen(group.lastISO)}</span>
              <CategoryLabel name={group.categoryName} color={group.categoryColor} />
              <Button variant="ghost" size="icon-xs" class="merch-note-btn" disabled={saving()} onClick={() => editNote(group.merchant)} aria-label={`Note on ${group.merchant}`} title="A note for Jev about this merchant"><NotebookPen /></Button>
            </div>
            <Show when={data.state.merchantNotes[merchantKey(group.merchant)]}>{(note) => <div class="merch-note faint small">{note()}</div>}</Show>
            <Show when={editing() === group.merchant}>
              <div class="merch-editor">
                <TextArea aria-label={`Note on ${group.merchant}`} disabled={saving()} value={draft()} onInput={(e) => setDraft(e.currentTarget.value)} />
                <div class="row"><Button variant="secondary" size="sm" disabled={saving()} onClick={() => void saveNote(group.merchant)}>Save</Button><Button variant="ghost" size="sm" disabled={saving()} onClick={() => setEditing(null)}>Cancel</Button></div>
              </div>
            </Show>
          </div>
        )}</For>
      </div>
    </div>
  )
}
