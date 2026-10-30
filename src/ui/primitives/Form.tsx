import { For, Show } from "solid-js"
import { theme, ink, tone } from "../../theme"
import type { FormField, FormNote } from "../../state/settingsForm"
import { S } from "./S"
import { TextInput } from "./TextInput"

/**
 * Editor fields, one per line: a marker on the focused field, labels padded
 * to one column, then the value. A focused text field shows a caret; a
 * focused choice or toggle is wrapped in ‹ ›; a picker says enter opens it;
 * a secret shows only its mask (`display`), with a caret at the end.
 */
export function Form(props: { fields: FormField[]; cursor: number; caret: number; note?: FormNote | null }) {
  const labelWidth = () => Math.max(...props.fields.map((f) => f.label.length)) + 2
  return (
    <>
      <For each={props.fields}>
        {(field, i) => {
          const focused = () => i() === props.cursor
          return (
            <text wrapMode="none" bg={focused() ? theme.rowCursor : undefined}>
              <S bg={focused() ? theme.rowCursor : undefined}>{" "}</S>
              <S fg={focused() ? ink.figure : ink.label} bg={focused() ? theme.rowCursor : undefined} bold={focused()}>{field.label.padEnd(labelWidth())}</S>
              <Show when={focused() && (field.kind === "choice" || field.kind === "toggle")}>
                <S fg={tone.key}>{"‹ "}</S>
              </Show>
              <Show when={field.kind === "text"} fallback={<S fg={field.display ? ink.figure : ink.faint}>{field.display || "—"}</S>}>
                <TextInput field={{ value: field.display, caret: props.caret }} focused={focused()} caretColor={tone.key} />
              </Show>
              <Show when={focused() && (field.kind === "choice" || field.kind === "toggle")}>
                <S fg={tone.key}>{" ›"}</S>
              </Show>
              <Show when={focused() && field.kind === "picker"}>
                <S fg={ink.note}>{"   enter to choose"}</S>
              </Show>
            </text>
          )
        }}
      </For>
      <Show when={props.note}>
        <text> </text>
        <text fg={props.note?.tone === "ok" ? tone.good : props.note?.tone === "error" ? tone.bad : ink.note} wrapMode="none">{`${props.note?.dot ? "● " : ""}${props.note?.text ?? ""}`}</text>
      </Show>
    </>
  )
}
