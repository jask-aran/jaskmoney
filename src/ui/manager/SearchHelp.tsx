import { For, Show } from "solid-js"
import { ui } from "../../state/uiStore"
import { theme } from "../../theme"
import { Modal } from "../primitives/Modal"
import { S } from "../primitives/S"

/** What to type in the search bar, one example per line. */
const EXAMPLES: Array<[string, string]> = [
  ["coffee", "description has coffee"],
  ["uber eats", "has both words"],
  ["kfc OR mcdonalds", "has either (OR in capitals)"],
  ["NOT uber", "leave these out"],
  ["cat:Groceries", "in a category"],
  ["tag:TRAVEL", "has a tag"],
  ["amt:<-50", "spent more than $50"],
  ["amt:>50", "received more than $50"],
  ["date:2026-10", "in October 2026"],
  ["date:2026-10-01..2026-10-14", "between two dates"],
  ["top:10", "only the 10 biggest"],
  ["?coffee last month", "ask in words"],
]

/** F1 in the search bar: the syntax, as examples. */
export function SearchHelp() {
  return (
    <Show when={ui.state.searchHelp}>
      <Modal title="Search" subtitle="type any of these" width={64} hints="esc close">
        <For each={EXAMPLES}>
          {([example, meaning]) => <text><S fg={theme.accent}>{example.padEnd(30)}</S><S fg={theme.subtext0}>{meaning}</S></text>}
        </For>
        <text fg={theme.overlay1}>{"Mix them: cat:Groceries amt:<-50 date:2026-10"}</text>
      </Modal>
    </Show>
  )
}
