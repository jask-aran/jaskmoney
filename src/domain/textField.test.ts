import { describe, expect, test } from "bun:test"
import { characters, editText, isPrintable, textField, type TextKey } from "./textField"
import { key } from "../testing/keys"

const type = (field: ReturnType<typeof textField>, ...keys: TextKey[]) => keys.reduce((f, k) => editText(f, k) ?? f, field)

describe("editText", () => {
  test("inserts and deletes at the caret", () => {
    const f = type(textField("cofee"), key("left"), key("left"), key("f"))
    expect(f).toEqual({ value: "coffee", caret: 4 })
    expect(type(f, key("backspace"))).toEqual({ value: "cofee", caret: 3 })
    expect(type(f, key("delete"))).toEqual({ value: "coffe", caret: 4 })
  })
  test("moves by character, word and to the ends", () => {
    const f = textField("amt:-10 desc:coles")
    expect(type(f, key("home")).caret).toBe(0)
    expect(type(f, key("a", { ctrl: true })).caret).toBe(0)
    expect(type(f, key("left", { meta: true })).caret).toBe(8)
    expect(type(f, key("home"), key("right", { meta: true })).caret).toBe(7)
    expect(type(f, key("home"), key("end")).caret).toBe(18)
  })
  test("ctrl+w, ctrl+u and ctrl+k delete around the caret", () => {
    const f = textField("amt:-10 desc:coles")
    expect(type(f, key("w", { ctrl: true }))).toEqual({ value: "amt:-10 ", caret: 8 })
    expect(type(f, key("left", { meta: true }), key("u", { ctrl: true }))).toEqual({ value: "desc:coles", caret: 0 })
    expect(type(f, key("left", { meta: true }), key("k", { ctrl: true }))).toEqual({ value: "amt:-10 ", caret: 8 })
  })
  test("leaves other keys to the caller", () => {
    expect(editText(textField("x"), key("return"))).toBeNull()
    expect(editText(textField("x"), key("escape"))).toBeNull()
    expect(editText(textField("x"), key("c", { ctrl: true }))).toBeNull()
  })
})

describe("characters are graphemes: an emoji is typed, moved over and deleted whole", () => {
  const key = (name: string, sequence = name, mods: Partial<{ ctrl: boolean; meta: boolean }> = {}) => ({ name, sequence, ctrl: false, meta: false, ...mods })
  test("an emoji (several code units, with its variation selector) types as one character", () => {
    expect(isPrintable(key("🏖️"))).toBe(true)
    expect(isPrintable(key("🇦🇺"))).toBe(true)
    expect(isPrintable(key("ab"))).toBe(false)
    expect(isPrintable(key("\u001b"))).toBe(false)
    expect(isPrintable(key("\u009b"))).toBe(false)
    expect(editText({ value: "go ", caret: 3 }, key("🏖️"))).toEqual({ value: "go 🏖️", caret: 6 })
  })
  test("backspace, delete and ←/→ step over a whole emoji", () => {
    const f = { value: "a🏖️b", caret: 4 }
    expect(editText(f, key("left"))).toEqual({ value: "a🏖️b", caret: 1 })
    expect(editText({ ...f, caret: 1 }, key("right"))).toEqual({ value: "a🏖️b", caret: 4 })
    expect(editText(f, key("backspace"))).toEqual({ value: "ab", caret: 1 })
    expect(editText({ ...f, caret: 1 }, key("delete"))).toEqual({ value: "ab", caret: 1 })
    expect(editText(f, key("b", "b", { ctrl: true }))).toEqual({ value: "a🏖️b", caret: 1 })
    expect(characters("a🏖️🇦🇺é")).toEqual(["a", "🏖️", "🇦🇺", "é"])
  })
})
