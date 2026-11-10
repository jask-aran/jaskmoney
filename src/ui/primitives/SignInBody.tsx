import { For, Show } from "solid-js"
import type { UiState } from "../../state/uiStore"
import { ink } from "../../theme"
import { TextInput } from "./TextInput"

type SignIn = NonNullable<UiState["llmSignIn"]>

const chunks = (text: string, width: number) => Array.from({ length: Math.ceil(text.length / width) }, (_, i) => text.slice(i * width, (i + 1) * width))

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
