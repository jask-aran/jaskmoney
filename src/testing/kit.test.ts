import { expect, test } from "bun:test"
import { isPrintable } from "../domain/textField"
import { transaction } from "./fixtures"
import { key } from "./keys"
import { testEnv } from "./scoped"

const probe = "JASKMONEY_TEST_KIT_PROBE"

test("testEnv keeps the latest value for the rest of the test", () => {
  expect(process.env[probe]).toBeUndefined()
  testEnv(probe, "first")
  testEnv(probe, "second")
  expect(process.env[probe]).toBe("second")
})

test("testEnv restores the value from before the test's first change", () => {
  expect(process.env[probe]).toBeUndefined()
})

test("key: characters and space type text as a terminal sends them; named keys type nothing", () => {
  expect(key("space").sequence).toBe(" ")
  expect(isPrintable(key("space"))).toBe(true)
  expect(isPrintable(key("j"))).toBe(true)
  for (const name of ["return", "escape", "left", "tab", "backspace"]) expect(isPrintable(key(name))).toBe(false)
  expect(isPrintable(key("u", { ctrl: true }))).toBe(false)
  expect(key("g", { shift: true, sequence: "G" }).sequence).toBe("G")
})

test("transaction fixtures never share arrays", () => {
  const a = transaction()
  a.tagNames.push("IGNORE")
  expect(transaction().tagNames).toEqual([])
  expect(transaction({ dateISO: "2026-01-02" }).dateRaw).toBe("2026-01-02")
})
