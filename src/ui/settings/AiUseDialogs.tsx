import { For, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { ui, type UiState } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { aiContext, useActions, useModel, type AiContext } from "../../state/aiDialog"
import { QUERIES, USES, useQueries, type QueryId } from "../../ai/catalog"
import { LLM_PROVIDERS } from "../../ai/llm"
import { queryLines } from "../../state/sentView"
import type { HelpTone } from "../../state/searchHelp"
import { theme, ink, tone } from "../../theme"
import { Modal } from "../primitives/Modal"
import { ListRow } from "../primitives/ListRow"
import { S } from "../primitives/S"
import { fit } from "../text"

const TONE: Record<HelpTone, string> = { head: ink.label, key: tone.key, text: ink.note, muted: ink.note }

/** The model answering a query now, as the dialogs name it. */
function queryModel(id: QueryId, ctx: AiContext): string {
  const model = QUERIES[id].model
  if (model === "clairic") return "Clairic (Cloudflare Workers AI)"
  if (model === "general") return useModel("rules", ctx).text
  return useModel("suggestions", ctx).text
}
const shortModel = (id: QueryId, ctx: AiContext) => QUERIES[id].model === "jev" ? "Jev" : QUERIES[id].model === "clairic" ? "Clairic" : LLM_PROVIDERS[ctx.inUse].label

/** The dialogs' width: wide enough for a feature, its keys and its code. */
const dialogWidth = (screen: number) => Math.max(60, Math.min(100, screen - 4))

/** A use's dialog: the model doing it; the app features it powers (how
 * you reach each, the code); what happens without a model; its queries
 * (enter opens one); then choosing its model. */
export function AiUseDialog() {
  const dims = useTerminalDimensions()
  const width = createMemo(() => dialogWidth(dims().width))
  return (
    <Show when={ui.state.aiUse}>
      {(d: () => NonNullable<UiState["aiUse"]>) => {
        const ctx = () => aiContext(data)
        const use = () => USES[d().use]
        const model = () => useModel(d().use, ctx())
        const queries = () => useQueries(d().use)
        const actions = () => useActions(d().use, ctx())
        const heading = (text: string, aside = "") => <text wrapMode="none"><S fg={ink.heading} bold>{text}</S><S fg={ink.note}>{aside}</S></text>
        // The label in a column; the value wraps beside it.
        const line = (label: string, value: string, fg: string = ink.figure) => (
          <box flexDirection="row">
            <text width={12} flexShrink={0} fg={ink.label}>{label}</text>
            <text flexGrow={1} flexShrink={1} wrapMode="word" fg={fg}>{value}</text>
          </box>
        )
        const inner = () => width() - 4
        const nameWidth = () => Math.max(...use().features.map((f) => f.name.length)) + 2
        return (
          <Modal title={use().name} subtitle="AI use" width={width()} hints="j/k move · enter open · esc close">
            {line("Model", model().text, model().ready ? tone.ai : tone.caution)}
            <text> </text>
            {heading("Features")}
            <For each={use().features}>{(f) => (
              <text wrapMode="none">
                <S fg={ink.figure}>{`  ${f.name.padEnd(nameWidth())}`}</S>
                <S fg={tone.key}>{fit(f.reach, 26).padEnd(28)}</S>
                <S fg={ink.note}>{fit(f.code, Math.max(8, inner() - nameWidth() - 30))}</S>
              </text>
            )}</For>
            <Show when={use().withoutModel}>
              <box paddingLeft={2}><text fg={ink.note} wrapMode="word">{`Without a model: ${use().withoutModel}`}</text></box>
            </Show>
            <text> </text>
            {heading("Queries", "   enter: what it asks, its context, the exact request")}
            <For each={queries()}>{(id, i) => (
              <ListRow cursor={d().cursor === i()} bg={theme.mantle} spans={[
                { text: QUERIES[id].name.padEnd(34), fg: ink.figure },
                { text: shortModel(id, ctx()).padEnd(12), fg: tone.ai },
                { text: fit(QUERIES[id].asks, Math.max(8, inner() - 48)), fg: ink.note },
              ]} />
            )}</For>
            <Show when={actions().length}>
              <text> </text>
              {heading("Model")}
              <For each={actions()}>{(action, i) => {
                const here = () => d().cursor === queries().length + i()
                return <ListRow cursor={here()} bg={theme.mantle} spans={[{ text: fit(action.label, inner() - 2), fg: ink.figure }]} />
              }}</For>
            </Show>
            <Show when={d().note}>
              {(n: () => NonNullable<NonNullable<UiState["aiUse"]>["note"]>) => (
                <>
                  <text> </text>
                  <text fg={n().ok === false ? tone.bad : tone.good} wrapMode="word">{n().text}</text>
                </>
              )}
            </Show>
          </Modal>
        )
      }}
    </Show>
  )
}

/** A query: what it asks, what comes back and what's done with it, when
 * it's sent, the code; its context blocks; then the exact request, built
 * without sending anything. Scrolls. */
export function AiQueryView() {
  const dims = useTerminalDimensions()
  const width = createMemo(() => Math.max(60, Math.min(110, dims().width - 4)))
  const lines = createMemo(() => {
    const view = ui.state.aiSent
    return view ? queryLines(view.query, queryModel(view.query, aiContext(data)), view.part, width() - 4, view.error) : []
  })
  // The border and hint lines, and a line of air above and below.
  const visible = createMemo(() => Math.max(5, dims().height - 8))
  createEffect(() => {
    const view = ui.state.aiSent
    if (view && (view.visible !== visible() || view.lines !== lines().length)) ui.setState("aiSent", { visible: visible(), lines: lines().length })
  })
  const top = () => Math.max(0, Math.min(ui.state.aiSent?.top ?? 0, lines().length - visible()))
  const hints = () => lines().length > visible() ? `j/k scroll · ${top() + 1}–${Math.min(lines().length, top() + visible())} of ${lines().length} · esc back` : "esc back"
  return (
    <Show when={ui.state.aiSent}>
      {(view: () => NonNullable<UiState["aiSent"]>) => (
        <Modal title={QUERIES[view().query].name} subtitle={`${USES[view().use].name} · query`} width={width()} hints={hints()}>
          <For each={lines().slice(top(), top() + visible())}>
            {(line) => (
              <text wrapMode="none">
                {line.length ? <For each={line}>{(part) => <S fg={TONE[part.tone]} bold={part.tone === "head"}>{part.text}</S>}</For> : " "}
              </text>
            )}
          </For>
        </Modal>
      )}
    </Show>
  )
}
