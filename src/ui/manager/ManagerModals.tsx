import { For, Show } from "solid-js"
import { ACCEPT_ALL_AT } from "../../domain/questions"
import type { Account } from "../../domain/types"
import { ACCOUNT_ACTIONS, armedFor } from "../../state/armed"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { ink, theme, tone } from "../../theme"
import { categoryMark } from "../icons"
import { ListRow } from "../primitives/ListRow"
import { Modal } from "../primitives/Modal"
import { S } from "../primitives/S"
import { fit } from "../text"
import { createManagerPreviews } from "./managerModel"

export function createAcceptModals(input: Pick<ReturnType<typeof createManagerPreviews>, "tagPreview" | "ACCEPT_LINES" | "acceptGroups">) {
  const { tagPreview, ACCEPT_LINES, acceptGroups } = input
  const AcceptModals = () => (
    <>
      <Show when={ui.state.acceptPreview && data.state.tagReview}>
        <Modal title={`Tag ${data.state.tagReview?.name ?? ""}`} subtitle={`${ui.state.acceptPreview?.length ?? 0} at ${ACCEPT_ALL_AT * 100}% or more`} width={72} hints="enter tag · esc cancel">
          <For each={tagPreview().slice(0, ACCEPT_LINES * 2)}>{(line) => <text wrapMode="none" fg={ink.figure}>{`  ${fit(line, 66)}`}</text>}</For>
          <Show when={tagPreview().length > ACCEPT_LINES * 2}>
            <text fg={ink.note}>{`  and ${tagPreview().length - ACCEPT_LINES * 2} more`}</text>
          </Show>
          <text> </text>
          <text fg={ink.note}>Up rows are tagged in Up too.</text>
        </Modal>
      </Show>
      <Show when={!data.state.tagReview && ui.state.acceptPreview}>
        {(ids: () => number[]) => (
          <Modal title="Accept suggestions" subtitle={`${ids().length} at ${ACCEPT_ALL_AT * 100}% or more`} width={72} hints="enter accept · esc cancel">
            <For each={acceptGroups().slice(0, ACCEPT_LINES)}>{(g) => (
              <>
                <text wrapMode="none">
                  <S fg={g.category?.color ?? ink.figure}>{`${categoryMark(g.category?.id ?? null)} `}</S>
                  <S fg={ink.figure}>{fit(g.category?.name ?? "?", 52)}</S>
                  <S fg={ink.note}>{String(g.n).padStart(6)}</S>
                </text>
                <text wrapMode="none" fg={ink.note}>{`  ${fit(g.rows, 64)}`}</text>
              </>
            )}</For>
            <Show when={acceptGroups().length > ACCEPT_LINES}>
              <text fg={ink.note}>{`and ${acceptGroups().length - ACCEPT_LINES} more ${acceptGroups().length - ACCEPT_LINES === 1 ? "category" : "categories"}`}</text>
            </Show>
            <text> </text>
            <text fg={ink.note}>Up rows are categorised in Up too.</text>
          </Modal>
        )}
      </Show>
    </>
  )
  return { AcceptModals }
}

export function createRuleModal(input: Pick<ReturnType<typeof createManagerPreviews>, "ruleOffers" | "ruleTop" | "RULE_LINES">) {
  const { ruleOffers, ruleTop, RULE_LINES } = input
  const RuleModal = () => (
    <>
      <Show when={ui.state.ruleOffers !== null}>
        <Modal title="Make rules" subtitle={data.state.writingRules ? "asking the AI…" : `${ruleOffers().length} offered`} width={76} hints="j/k move · enter choose · x never offer · esc later">
          <text fg={ink.note}>New rows these find get the category on sync, without review.</text>
          <text> </text>
          <For each={ruleOffers().slice(ruleTop(), ruleTop() + RULE_LINES)}>{(offer, i) => {
            const category = () => data.state.categories.find((c) => c.id === offer.categoryId)
            const tag = () => data.state.tags.find((t) => t.id === offer.tagId)
            const at = () => ruleTop() + i() === ui.state.ruleOffers!.cursor
            return (
              <>
                <ListRow cursor={at()} bg={theme.mantle} spans={[
                  { text: ` ${fit(offer.description, 34)}`, fg: ink.figure },
                  { text: " → ", fg: ink.rule },
                  { text: offer.tagId != null ? fit(`+${tag()?.name ?? "?"}`, 32) : `${categoryMark(offer.categoryId)} ${fit(category()?.name ?? "?", 30)}`, fg: tag()?.color ?? category()?.color ?? ink.figure },
                ]} />
                <text wrapMode="none" fg={ink.note}>{fit(`    ${offer.source === "ai" ? `AI · ${offer.expr}` : `you chose it ${offer.times}×`} · ${offer.agreeing} of ${offer.categorised} found are there${offer.waiting.length ? ` · ${offer.waiting.length} waiting` : ""}`, 72)}</text>
                <Show when={offer.why}>
                  <text wrapMode="none" fg={ink.note}>{fit(`    ${offer.why}`, 72)}</text>
                </Show>
                <Show when={offer.others.length}>
                  <text wrapMode="none" fg={tone.caution}>{fit(`    also finds ${offer.others.join(", ")}`, 72)}</text>
                </Show>
              </>
            )
          }}</For>
          <Show when={!!data.state.llm && ruleOffers().length >= ruleTop() && ruleOffers().length < ruleTop() + RULE_LINES}>
            <ListRow cursor={ui.state.ruleOffers!.cursor === ruleOffers().length} bg={theme.mantle} spans={[{ text: ` ${data.state.writingRules ? `Asking ${data.state.llm}…` : "Ask the AI for more rules"}`, fg: tone.ai }]} />
          </Show>
          <Show when={ruleOffers().length + (!!data.state.llm ? 1 : 0) > RULE_LINES}>
            <text fg={ink.note}>{`  ${ruleTop() + 1}–${Math.min(ruleTop() + RULE_LINES, ruleOffers().length + (!!data.state.llm ? 1 : 0))} of ${ruleOffers().length + (!!data.state.llm ? 1 : 0)}`}</text>
          </Show>
        </Modal>
      </Show>
    </>
  )
  return { RuleModal }
}

export function createAccountModal(input: Pick<ReturnType<typeof createManagerPreviews>, "accountAction">) {
  const { accountAction } = input
  const AccountModal = () => (
    <>
      <Show when={accountAction()}>
        {(account: () => Account) => (
          <Modal title="Account data" subtitle={account().name} tone="warning" width={68} hints="j/k move · enter, enter again · esc cancel">
            <For each={ACCOUNT_ACTIONS}>{(kind, i) => (
              <ListRow cursor={(ui.state.accountAction?.cursor ?? 0) === i()} bg={theme.mantle} armed={armedFor(ui.state.armed, kind, account().id)} spans={[
                { text: kind === "clearAccount" ? "Clear this account’s transactions" : "Remove this account and its transactions", fg: kind === "clearAccount" ? ink.figure : tone.bad },
              ]} />
            )}</For>
          </Modal>
        )}
      </Show>
    </>
  )
  return { AccountModal }
}
