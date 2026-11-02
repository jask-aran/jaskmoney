import { expect, test } from "bun:test"
import { safeToOpen } from "./llmSignIn"
import { traceKeyName } from "./trace"

test("only https pages and this machine's http go to the OS opener", () => {
  expect(safeToOpen("https://example.com/sign-in?state=x")).toBe(true)
  expect(safeToOpen("http://127.0.0.1:4417/")).toBe(true)
  expect(safeToOpen("http://localhost:1455/auth/callback")).toBe(true)
  for (const bad of ["http://example.com/", "file:///etc/passwd", "javascript:alert(1)", "vscode://x", "--help", "", "not a url"]) expect(safeToOpen(bad)).toBe(false)
})

test("the trace names keys, never the characters typed", () => {
  const key = (name: string, extra: Partial<{ ctrl: boolean; meta: boolean; shift: boolean }> = {}) => ({ name, sequence: name, ctrl: false, meta: false, shift: false, ...extra })
  expect(traceKeyName(key("a"))).toBe("char")
  expect(traceKeyName(key("Z", { shift: true }))).toBe("char")
  expect(traceKeyName(key("return"))).toBe("return")
  expect(traceKeyName(key("k", { ctrl: true }))).toBe("ctrl+k")
  expect(traceKeyName(key("tab", { shift: true }))).toBe("shift+tab")
})
