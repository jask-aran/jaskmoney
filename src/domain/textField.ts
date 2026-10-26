/**
 * Single-line text editing with a caret, shared by every text-entry context
 * (filter, notes, settings editors, import dialogs). Pure: `editText` maps a
 * key to the next field, or null when the key is not a text edit (so the
 * caller's own bindings, e.g. enter or esc, still apply).
 *
 * Keys: printable characters insert at the caret; backspace / delete remove
 * before / after it; ←/→ (ctrl+b / ctrl+f) move one character; home / end
 * (ctrl+a / ctrl+e) jump to the ends; alt+←/→ move a word; ctrl+w deletes
 * the word before the caret; ctrl+u deletes to the start, ctrl+k to the end.
 * The caret is a code-unit index into `value`, 0..value.length.
 */
export interface TextField {
  value: string
  caret: number
}

/** The parts of a key event editing reads (a subset of OpenTUI's KeyEvent). */
export interface TextKey {
  name: string
  sequence: string
  ctrl: boolean
  meta: boolean
}

/** A key that types its own character: one printable code unit, no ctrl/meta. */
export function isPrintable(key: TextKey): boolean {
  if (key.ctrl || key.meta) return false
  const s = key.sequence
  if (!s || s.length !== 1) return false
  const code = s.charCodeAt(0)
  return code >= 32 && code !== 127
}

/** A field holding `value` with the caret at its end. */
export function textField(value = ""): TextField {
  return { value, caret: value.length }
}

/** The caret clamped into the value (a stored caret may predate an edit). */
export function clampCaret(field: TextField): number {
  return Math.max(0, Math.min(field.value.length, field.caret))
}

const wordStart = (value: string, from: number) => {
  let i = from
  while (i > 0 && value[i - 1] === " ") i--
  while (i > 0 && value[i - 1] !== " ") i--
  return i
}
const wordEnd = (value: string, from: number) => {
  let i = from
  while (i < value.length && value[i] === " ") i++
  while (i < value.length && value[i] !== " ") i++
  return i
}

export function editText(field: TextField, key: TextKey): TextField | null {
  const { value } = field
  const caret = clampCaret(field)
  const at = (v: string, c: number): TextField => ({ value: v, caret: c })
  if (isPrintable(key)) return at(value.slice(0, caret) + key.sequence + value.slice(caret), caret + key.sequence.length)
  const name = key.name
  if (key.meta && (name === "left" || name === "b")) return at(value, wordStart(value, caret))
  if (key.meta && (name === "right" || name === "f")) return at(value, wordEnd(value, caret))
  if (key.ctrl) {
    if (name === "a") return at(value, 0)
    if (name === "e") return at(value, value.length)
    if (name === "b") return at(value, Math.max(0, caret - 1))
    if (name === "f") return at(value, Math.min(value.length, caret + 1))
    if (name === "u") return at(value.slice(caret), 0)
    if (name === "k") return at(value.slice(0, caret), caret)
    if (name === "w") { const start = wordStart(value, caret); return at(value.slice(0, start) + value.slice(caret), start) }
    return null
  }
  if (key.meta) return null
  if (name === "left") return at(value, Math.max(0, caret - 1))
  if (name === "right") return at(value, Math.min(value.length, caret + 1))
  if (name === "home") return at(value, 0)
  if (name === "end") return at(value, value.length)
  if (name === "backspace") return caret === 0 ? at(value, 0) : at(value.slice(0, caret - 1) + value.slice(caret), caret - 1)
  if (name === "delete") return at(value.slice(0, caret) + value.slice(caret + 1), caret)
  return null
}
