import { For, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { ui } from "../../state/uiStore"
import { SEARCH_HELP, SEARCH_HELP_FULL, SEARCH_HELP_WIDTH, type HelpTone } from "../../state/searchHelp"
import { ink, tone } from "../../theme"
import { Modal } from "../primitives/Modal"
import { S } from "../primitives/S"

const TONE: Record<HelpTone, string> = { head: ink.heading, key: tone.key, text: ink.note, muted: ink.note }

/** F1 in the search bar: JQL, brief (the language in a sentence, an
 * example, the terms, precedence, gotchas) or full (m: what the rule
 * writer's model is given); scrolls when the screen is too short for it. */
export function SearchHelp() {
  const dims = useTerminalDimensions()
  const lines = () => ((ui.state.searchHelp?.full ?? false) ? SEARCH_HELP_FULL : SEARCH_HELP)
  // The modal's border and hint lines, and a line of air above and below.
  const visible = createMemo(() => Math.max(5, Math.min(lines().length, dims().height - 8)))
  createEffect(() => { if (ui.state.searchHelp && (ui.state.searchHelp?.visible ?? 0) !== visible()) ui.setState("searchHelp", { visible: visible() }) })
  const top = () => Math.min((ui.state.searchHelp?.top ?? 0), lines().length - visible())
  const toggle = () => ((ui.state.searchHelp?.full ?? false) ? "m brief" : "m full grammar")
  const hints = () => visible() < lines().length
    ? `${toggle()} · j/k scroll · ${top() + 1}–${top() + visible()} of ${lines().length} · esc close`
    : `${toggle()} · esc close`
  return (
    <Show when={ui.state.searchHelp}>
      <Modal title="JQL" subtitle={(ui.state.searchHelp?.full ?? false) ? "Jask Query Language, in full" : "Jask Query Language"} width={SEARCH_HELP_WIDTH + 4} hints={hints()}>
        <For each={lines().slice(top(), top() + visible())}>
          {(line) => (
            <text wrapMode="none">
              {line.length ? <For each={line}>{(part) => <S fg={TONE[part.tone]} bold={part.tone === "head"}>{part.text}</S>}</For> : " "}
            </text>
          )}
        </For>
      </Modal>
    </Show>
  )
}
