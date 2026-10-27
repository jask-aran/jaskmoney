import { For, Show } from "solid-js"
import { theme } from "../../theme"
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
            <text wrapMode="none">
              <S fg={theme.accent} bold>{focused() ? "› " : "  "}</S>
              <S fg={focused() ? theme.text : theme.subtext0} bold={focused()}>{field.label.padEnd(labelWidth())}</S>
              <Show when={focused() && (field.kind === "choice" || field.kind === "toggle")}>
                <S fg={theme.accent}>{"‹ "}</S>
              </Show>
              <Show when={field.kind === "text"} fallback={
                <Show when={field.kind === "secret"} fallback={<S fg={field.display ? theme.text : theme.overlay0}>{field.display || "—"}</S>}>
                  <S fg={field.display.startsWith("•") ? theme.text : theme.overlay0}>{field.display}</S>
                  <S fg={theme.accent}>{focused() ? "▏" : ""}</S>
                </Show>
              }>
                <TextInput field={{ value: field.display, caret: props.caret }} focused={focused()} caretColor={theme.accent} />
              </Show>
              <Show when={focused() && (field.kind === "choice" || field.kind === "toggle")}>
                <S fg={theme.accent}>{" ›"}</S>
              </Show>
              <Show when={focused() && field.kind === "picker"}>
                <S fg={theme.overlay1}>{"   enter to choose"}</S>
              </Show>
            </text>
          )
        }}
      </For>
      <Show when={props.note}>
        <text> </text>
        <text fg={props.note?.tone === "ok" ? theme.success : props.note?.tone === "error" ? theme.error : theme.overlay1} wrapMode="none">{`${props.note?.dot ? "● " : ""}${props.note?.text ?? ""}`}</text>
      </Show>
    </>
  )
}
