import { Show } from "solid-js"
import { ui } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { merchantKey } from "../../domain/history"
import { theme } from "../../theme"
import { Modal } from "../primitives/Modal"
import { TextInput } from "../primitives/TextInput"

/** n (Merchants) or N (a row): what you buy at a merchant, in words, shown
 * to Jev with its rows. Says why the merchant was flagged, when it was. */
export function MerchantNoteBox() {
  return (
    <Show when={ui.state.merchantNote}>
      {(box: () => NonNullable<typeof ui.state.merchantNote>) => {
        const why = () => {
          const prompt = data.notePrompts().get(merchantKey(box().merchant))
          if (!prompt) return null
          if (prompt.kind === "varies") return "What you buy here varies, so suggestions for it are guesses."
          const category = data.state.categories.find((c) => c.id === prompt.categoryId)?.name ?? "one category"
          return `Nearly always ${category} so far, but its name reads as broad, so suggestions for it are guesses.`
        }
        return (
          <Modal title={`Note · ${box().merchant}`} subtitle="for suggestions" width={72} hints="enter save · empty removes · esc cancel">
            <Show when={why()}>{(text: () => string) => <text fg={theme.overlay1}>{text()}</text>}</Show>
            <text fg={theme.subtext0}>What you buy here, e.g. "varies: gifts, homewares" or "always groceries".</text>
            <text fg={theme.text}>Note: <TextInput field={{ value: box().draft, caret: box().caret }} focused /></text>
          </Modal>
        )
      }}
    </Show>
  )
}
