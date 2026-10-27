import { For, Show } from "solid-js"
import { LLM_PROVIDERS } from "../../ai/llm"
import { ui, type UiState } from "../../state/uiStore"

type SignIn = NonNullable<UiState["llmSignIn"]>

const WIDTH = 78
/** Inside the border and padding. */
const INNER = WIDTH - 4

/** An address cut into full lines of `width`, every character kept, to copy by hand. */
const chunks = (text: string, width: number) => Array.from({ length: Math.ceil(text.length / width) }, (_, i) => text.slice(i * width, (i + 1) * width))
import { theme } from "../../theme"
import { Modal } from "./Modal"
import { TextInput } from "./TextInput"

/** A browser sign-in in progress (app/llmSignIn): what's happening, the
 * address (to open by hand if the browser didn't), and the paste field
 * when the callback can't arrive. */
export function SignInModal() {
  const flow = () => ui.state.llmSignIn
  return (
    <Show when={flow()}>
      {(f: () => SignIn) => (
        <Modal title={LLM_PROVIDERS[f().provider].signIn} width={WIDTH} hints={f().paste ? "enter send · esc cancel" : "esc cancel"}>
          <text fg={theme.text}>{f().message}</text>
          <Show when={f().url}>
            <text> </text>
            <text fg={theme.overlay1}>If it didn't open, open this address:</text>
            <For each={chunks(f().url!, INNER)}>{(line) => <text fg={theme.teal} wrapMode="none">{line}</text>}</For>
          </Show>
          <Show when={f().paste}>
            {(paste: () => NonNullable<SignIn["paste"]>) => (
              <>
                <text> </text>
                <text fg={theme.overlay1} wrapMode="word">{paste().message}</text>
                <text fg={theme.text}>{"> "}<TextInput field={{ value: paste().value, caret: paste().caret }} focused /></text>
              </>
            )}
          </Show>
        </Modal>
      )}
    </Show>
  )
}
