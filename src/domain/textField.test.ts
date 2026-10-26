import { describe, expect, test } from "bun:test"
import { editText, textField, type TextKey } from "./textField"
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
