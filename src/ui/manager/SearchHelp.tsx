import { For, Show, createEffect, createMemo } from "solid-js"
import { useTerminalDimensions } from "@opentui/solid"
import { ui } from "../../state/uiStore"
import { SEARCH_HELP, SEARCH_HELP_WIDTH, type HelpTone } from "../../state/searchHelp"
import { theme } from "../../theme"
import { Modal } from "../primitives/Modal"
import { S } from "../primitives/S"

const TONE: Record<HelpTone, string> = { head: theme.text, key: theme.accent, text: theme.subtext0, muted: theme.overlay1 }

/** F1 in the search bar: how searches read, then examples; scrolls when the
 * screen is too short for it all. */
export function SearchHelp() {
  const dims = useTerminalDimensions()
  // The modal's border and hint lines, and a line of air above and below.
  const visible = createMemo(() => Math.max(5, Math.min(SEARCH_HELP.length, dims().height - 8)))
  createEffect(() => { if (ui.state.searchHelp && ui.state.searchHelpVisible !== visible()) ui.setState({ searchHelpVisible: visible() }) })
  const top = () => Math.min(ui.state.searchHelpTop, SEARCH_HELP.length - visible())
  const hints = () => visible() < SEARCH_HELP.length
    ? `j/k scroll · ${top() + 1}–${top() + visible()} of ${SEARCH_HELP.length} · esc close`
    : "esc close"
  return (
    <Show when={ui.state.searchHelp}>
      <Modal title="JQL" subtitle="Jask Query Language: how a search reads" width={SEARCH_HELP_WIDTH + 4} hints={hints()}>
        <For each={SEARCH_HELP.slice(top(), top() + visible())}>
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
