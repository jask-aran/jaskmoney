export interface TextField {
  value: string
  caret: number
}

export interface TextKey {
  name: string
  sequence: string
  ctrl: boolean
  meta: boolean
}

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" })

export function characters(text: string): string[] {
  return Array.from(graphemes.segment(text), (s) => s.segment)
}

export function isPrintable(key: TextKey): boolean {
  if (key.ctrl || key.meta) return false
  const s = key.sequence
  if (!s || characters(s).length !== 1) return false
  return !/[\u0000-\u001f\u007f-\u009f]/.test(s)
}

function before(value: string, caret: number): number {
  let edge = 0
  for (const s of graphemes.segment(value)) { if (s.index >= caret) break; edge = s.index }
  return edge
}
function after(value: string, caret: number): number {
  for (const s of graphemes.segment(value)) if (s.index + s.segment.length > caret) return s.index + s.segment.length
  return value.length
}

export function textField(value = ""): TextField {
  return { value, caret: value.length }
}

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
