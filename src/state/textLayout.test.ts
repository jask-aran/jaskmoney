import { expect, test } from "bun:test"
import { wrapText } from "./textLayout"
import { searchHelpLines } from "./searchHelp"
import { requestLines } from "./sentView"
import { useQueries } from "../ai/catalog"

test("C3.8 word wrap keeps paragraphs, splits long words, and clamps width", () => {
  expect(wrapText("one two\n\nabcdefgh ij", 4)).toEqual(["one", "two", "", "abcd", "efgh", "ij"])
  expect(wrapText("", 4)).toEqual([""])
  expect(wrapText("ab\nc", 0)).toEqual(["a", "b", "c"])
  expect(wrapText("ab", -3)).toEqual(["a", "b"])
  expect(wrapText("abc def ghi", 7)).toEqual(["abc def", "ghi"])
})

test("C3.8 search help and sent requests split words with the same wrapper", () => {
  const token = "abcdefghijklmnopqrstuvwxyz0123456789"
  const lines = requestLines({ query: useQueries("suggestions")[0]!, to: "local", body: { text: `${token}\n\nend` }, sample: "test" }, 24)
  const text = lines.flatMap((line) => line.filter((span) => span.tone === "text").map((span) => span.text.trimStart()))
  expect(text).toEqual(["abcdefghijklmnopqrst", "uvwxyz0123456789", "", "end"])
  const firstMeaning = searchHelpLines(true, 30).find((line) => line[0]?.text.trim() === "coffee")
  expect(firstMeaning).toBeDefined()
  const available = 30 - firstMeaning![0]!.text.length
  expect(available).toBeLessThan("description".length)
  expect(firstMeaning![1]!.text).toBe("description".slice(0, available))
  for (const line of searchHelpLines(true, 30)) {
    // Meanings wrap in the space after the term column.
    for (const span of line.filter((span) => span.tone === "text")) expect(span.text.length).toBeLessThanOrEqual(30)
  }
})

test("wraps by terminal columns: wide characters take two, an emoji is never cut in half", () => {
  expect(wrapText("東京 東京", 4)).toEqual(["東京", "東京"])
  expect(wrapText("東京東京", 3)).toEqual(["東", "京", "東", "京"])
  expect(wrapText("🏖️ Holiday 🏖️ Holiday", 10)).toEqual(["🏖️ Holiday", "🏖️ Holiday"])
  expect(wrapText("🏖️🏖️🏖️", 4)).toEqual(["🏖️🏖️", "🏖️"])
})
