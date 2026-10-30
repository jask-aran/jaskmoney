import { For, Show } from "solid-js"
import type { UiState } from "../../state/uiStore"

type SignIn = NonNullable<UiState["llmSignIn"]>

/** An address cut into full lines of `width`, every character kept, to copy by hand. */
const chunks = (text: string, width: number) => Array.from({ length: Math.ceil(text.length / width) }, (_, i) => text.slice(i * width, (i + 1) * width))
import { ink } from "../../theme"
import { TextInput } from "./TextInput"

/** A browser sign-in in progress (app/llmSignIn), inside the AI models
 * dialog: what's happening, the address (to open by hand if the browser
 * didn't), and the paste field when the callback can't arrive. */
export function SignInBody(props: { flow: SignIn; width: number }) {
  return (
    <>
      <text fg={ink.note} wrapMode="word">{props.flow.message}</text>
      <Show when={props.flow.url}>
        <text> </text>
        <text fg={ink.note}>If it didn't open, open this address:</text>
        <For each={chunks(props.flow.url!, props.width)}>{(line) => <text fg={ink.figure} wrapMode="none">{line}</text>}</For>
      </Show>
      <Show when={props.flow.paste}>
        {(paste: () => NonNullable<SignIn["paste"]>) => (
          <>
            <text> </text>
            <text fg={ink.note} wrapMode="word">{paste().message}</text>
            <text fg={ink.figure}>{"> "}<TextInput field={{ value: paste().value, caret: paste().caret }} focused /></text>
          </>
        )}
      </Show>
    </>
  )
}
