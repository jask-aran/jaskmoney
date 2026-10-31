import { For, Show, createMemo, createSignal, onCleanup } from "solid-js"
import type { RuleOffer } from "../../../domain/ruleOffers"
import { data, run, say } from "../../store"
import { Empty } from "../../ui"
import { X } from "lucide-solid"
import { Button, Frost } from "../../v2"
import "./review.css"

export function RuleOffers(props: { onClose: () => void }) {
  const { onClose } = props
  let active = true
  onCleanup(() => { active = false })
  const offers = createMemo(() => data.allRuleOffers().map((offer) => {
    const target = offer.tagId != null ? data.state.tags.find((tag) => tag.id === offer.tagId) : data.state.categories.find((category) => category.id === offer.categoryId)
    return { offer, name: `${offer.tagId != null ? "+" : ""}${target?.name ?? "?"}`, color: target?.color }
  }))
  const [busy, setBusy] = createSignal(false)
  const close = () => { active = false; say("Transactions"); onClose() }
  const settle = () => {
    if (active && !data.allRuleOffers().length && !data.state.llm) { active = false; onClose() }
  }
  const accept = (offer: RuleOffer) => {
    setBusy(true)
    say(`Making a rule for ${offer.description}…`)
    void run(data.makeOfferedRule(offer), (summary) => {
      if (!active) return
      say(summary)
      settle()
    }).then(() => { if (active) setBusy(false) })
  }
  const decline = (offer: RuleOffer) => {
    setBusy(true)
    const description = offer.description
    void run(data.declineRuleOffer(offer), () => {
      if (!active) return
      say(`No rule for ${description}; it won't be offered again`)
      settle()
    }).then(() => { if (active) setBusy(false) })
  }
  return (
    <Frost as="div" lift="raised" class="jm-drawer" role="dialog" aria-label="Make rules">
      <header class="jm-drawer-head"><div class="grow"><div class="jm-drawer-title">Make rules</div><div class="small note">{offers().length} offered</div></div><Button variant="ghost" size="icon-sm" aria-label="Close" onClick={close}><X /></Button></header>
      <div class="jm-drawer-body">
        <For each={offers()} fallback={<Empty>No rules offered yet</Empty>}>{(row) => {
          const { offer } = row
          return (
            <div class="rule-offers-offer">
              <div class="row"><span class="figure">{offer.description}</span><span class="note">→</span><span class="dot" style={{ background: row.color }} /><span class="label">{row.name}</span></div>
              <div class="small note mono">{offer.expr}</div>
              <div class="small note">{offer.source === "ai" ? `AI · ${offer.expr}` : `you chose it ${offer.times}×`} · {offer.agreeing} of {offer.categorised} found are there{offer.waiting.length ? ` · ${offer.waiting.length} waiting` : ""}</div>
              <Show when={offer.why}><div class="small note">{offer.why}</div></Show>
              <Show when={offer.others.length}><div class="small caution">also finds {offer.others.join(", ")}</div></Show>
              <div class="row"><Button variant="primary" size="sm" disabled={busy()} onClick={() => accept(offer)}>Accept</Button><Button variant="secondary" size="sm" disabled={busy()} onClick={() => decline(offer)}>Decline</Button></div>
            </div>
          )
        }}</For>
      </div>
    </Frost>
  )
}
