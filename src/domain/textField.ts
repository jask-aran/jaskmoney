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
 * The caret is a code-unit index into `value`, 0..value.length, always on a
 * character's edge: a character is a grapheme (an emoji with its variation
 * selector, a flag, a letter with its accent), typed, moved over and deleted
 * whole; a code unit at a time split "🏖️" in two.
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

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

/** The text as characters (graphemes): what a caret steps over. */
export function characters(text: string): string[] {
  return Array.from(graphemes.segment(text), (s) => s.segment)
}

/** A key that types its own character: one printable character (a
 * grapheme, which may be several code units: an emoji), no ctrl/meta. */
export function isPrintable(key: TextKey): boolean {
  if (key.ctrl || key.meta) return false
  const s = key.sequence
  if (!s || characters(s).length !== 1) return false
  // No control characters (C0, DEL, C1) anywhere in it.
  return !/[\u0000-\u001f\u007f-\u009f]/.test(s)
}

/** The character edge before / after `caret` (graphemes, not code units). */
function before(value: string, caret: number): number {
  let edge = 0
  for (const s of graphemes.segment(value)) { if (s.index >= caret) break; edge = s.index }
  return edge
}
function after(value: string, caret: number): number {
  for (const s of graphemes.segment(value)) if (s.index + s.segment.length > caret) return s.index + s.segment.length
  return value.length
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
    if (name === "b") return at(value, before(value, caret))
    if (name === "f") return at(value, after(value, caret))
    if (name === "u") return at(value.slice(caret), 0)
    if (name === "k") return at(value.slice(0, caret), caret)
    if (name === "w") { const start = wordStart(value, caret); return at(value.slice(0, start) + value.slice(caret), start) }
    return null
  }
  if (key.meta) return null
  if (name === "left") return at(value, before(value, caret))
  if (name === "right") return at(value, after(value, caret))
  if (name === "home") return at(value, 0)
  if (name === "end") return at(value, value.length)
  if (name === "backspace") { const from = before(value, caret); return at(value.slice(0, from) + value.slice(caret), from) }
  if (name === "delete") return at(value.slice(0, caret) + value.slice(after(value, caret)), caret)
  return null
}
