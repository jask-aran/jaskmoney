import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import { ACCEPT_ALL_AT } from "../../../domain/questions"
import { groupForTag, TAG_SHOW_AT, tripDates, type TagTarget } from "../../../domain/tagSuggest"
import { count } from "../../../domain/words"
import { data, run, say } from "../../store"
import { confidenceClass, Empty, Money } from "../../ui"
import { Check, X } from "lucide-solid"
import { Button, Frost, GroupHeading, Input } from "../../v2"
import "./review.css"

export function TagReview(props: { onClose: () => void }) {
  const { onClose } = props
  let active = true
  onCleanup(() => { active = false })
  const [name, setName] = createSignal("")
  const [selected, setSelected] = createSignal(new Set<number>())
  const [busy, setBusy] = createSignal(false)
  const rows = createMemo(() => {
    const review = data.state.tagReview
    if (!review) return []
    return data.transactions().flatMap((transaction) => {
      const candidate = review.candidates[transaction.id]
      return candidate && candidate.confidence >= TAG_SHOW_AT ? [{ transaction, candidate }] : []
    }).sort((a, b) => b.candidate.confidence - a.candidate.confidence)
  })
  const selectedIds = createMemo(() => rows().filter((row) => selected().has(row.transaction.id)).map((row) => row.transaction.id))
  const confidentIds = createMemo(() => rows().filter((row) => row.candidate.confidence >= ACCEPT_ALL_AT).map((row) => row.transaction.id))
  const newName = createMemo(() => name().trim())
  const tags = createMemo(() => data.state.tags.filter((tag) => tag.name.toUpperCase() !== "IGNORE"))
  const existing = createMemo(() => data.state.tags.find((tag) => tag.name.toLowerCase() === newName().toLowerCase()))

  const close = () => { active = false; data.closeTagReview(); say("Transactions"); onClose() }
  const choose = (target: TagTarget) => {
    if (busy()) return
    setSelected(new Set<number>())
    const note = tripDates(target.group) && target.categoryIds.length ? " · within the trip's dates, any category" : ""
    say(`Finding transactions for ${target.name}…${note}`)
    void run(data.openTagReview(target), (summary) => { if (active && summary) say(summary + note) })
  }
  const accept = (ids: number[]) => {
    const review = data.state.tagReview
    if (!review || !ids.length) return
    setBusy(true)
    say(`Tagging ${count(ids.length, "transaction")} ${review.name}…`)
    void run(data.acceptTagCandidates(ids), (summary) => { if (active && summary) say(summary, summary.includes("failed")) }).then(() => {
      if (!active) return
      setSelected(new Set<number>()); setBusy(false)
    })
  }
  const dismiss = () => {
    const ids = selectedIds()
    if (!ids.length) return
    setBusy(true)
    void run(data.dismissTagCandidates(ids), () => { if (active) say(`Dismissed ${count(ids.length, "candidate")} for this session`) }).then(() => {
      if (!active) return
      setSelected(new Set<number>()); setBusy(false)
    })
  }
  const toggle = (id: number) => setSelected((previous) => {
    const next = new Set(previous)
    if (next.has(id)) next.delete(id); else next.add(id)
    return next
  })

  return (
    <Frost as="div" lift="raised" class="jm-drawer" role="dialog" aria-label="Find transactions for a tag">
      <header class="jm-drawer-head"><div class="grow"><div class="jm-drawer-title">Find transactions for a tag</div><div class="small note">Choose a tag or name a new one</div></div><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={close}><X /></Button></header>
      <div class="jm-drawer-body">
        <section class="tag-review-choices"><GroupHeading>Tags</GroupHeading>
          <div class="jm-tags"><For each={tags()}>{(tag) => (
            <button type="button" class="jm-tag" aria-pressed={data.state.tagReview?.tagId === tag.id} disabled={busy()} onClick={() => {
              const group = groupForTag(tag.name, data.tagGroups())
              choose({ tagId: tag.id, name: tag.name, categoryIds: tag.categoryIds, about: tag.about, ...(group ? { group } : {}) })
            }}><span class="dot" style={{ background: tag.color }} />{tag.name}</button>
          )}</For></div>
          <form class="row" onSubmit={(event) => { event.preventDefault(); if (newName() && !existing()) choose({ tagId: null, name: newName(), categoryIds: [], about: null }) }}>
            <Input class="grow" aria-label="New tag name" placeholder="New tag name" value={name()} onInput={(event) => setName(event.currentTarget.value)} />
            <Button type="submit" variant="secondary" size="sm" disabled={!newName() || !!existing() || busy()}>Find</Button>
          </form>
        </section>
        <Show when={data.state.tagReview}>{(review) => (
          <>
            <div class="row"><span class="heading grow">{review().name}</span><Show when={review().asking}><span class="small note">Jev judging…</span></Show></div>
            <div class="tag-review-actions">
              <Button variant="primary" size="sm" disabled={!selectedIds().length || busy()} onClick={() => accept(selectedIds())}>Accept</Button>
              <Button variant="secondary" size="sm" disabled={!confidentIds().length || busy()} onClick={() => accept(confidentIds())}>Accept all ≥{ACCEPT_ALL_AT * 100}%</Button>
              <Button variant="secondary" size="sm" disabled={!selectedIds().length || busy()} onClick={dismiss}>Dismiss</Button>
            </div>
            <div class="tag-review-list"><For each={rows()} fallback={<Empty>{review().asking ? "Asking Jev…" : "Nothing more to tag"}</Empty>}>{(row) => (
              <label class="tag-review-row" data-selected={selected().has(row.transaction.id) ? "" : undefined}>
                <input class="tag-review-input" type="checkbox" checked={selected().has(row.transaction.id)} disabled={busy()} onChange={() => toggle(row.transaction.id)} aria-label={`Select ${row.transaction.description}`} />
                <span class="tag-review-check" aria-hidden="true"><Show when={selected().has(row.transaction.id)}><Check /></Show></span>
                <span class="grow"><span class="tag-review-description">{row.transaction.description}</span><span class="small note">{row.transaction.dateISO}</span></span>
                <span class={`conf ${confidenceClass(row.candidate.confidence)}`} title={row.candidate.source}>{row.candidate.source === "history" ? "↺" : row.candidate.source === "group" ? "◆" : ""}{Math.round(row.candidate.confidence * 100)}%</span>
                <Money value={row.transaction.amount} />
              </label>
            )}</For></div>
          </>
        )}</Show>
      </div>
    </Frost>
  )
}
