import { Show } from "solid-js"
import { theme, ink, tone } from "../../theme"
import { clampCaret, type TextField } from "../../domain/textField"
import { S } from "./S"

export function TextInput(props: { field: TextField; focused: boolean; fg?: string; caretColor?: string; placeholder?: string }) {
  const caret = () => clampCaret(props.field)
  const fg = () => props.fg ?? ink.figure
  const caretColor = () => props.caretColor ?? tone.focus
  return (
    <Show
      when={props.focused}
      fallback={<S fg={props.field.value ? fg() : ink.faint}>{props.field.value || props.placeholder || ""}</S>}
    >
      <S fg={fg()}>{props.field.value.slice(0, caret())}</S>
      <Show when={caret() < props.field.value.length} fallback={<S fg={caretColor()}>▌</S>}>
        <S fg={theme.rowCursorText} bg={caretColor()}>{props.field.value[caret()]}</S>
        <S fg={fg()}>{props.field.value.slice(caret() + 1)}</S>
      </Show>
    </Show>
  )
}
