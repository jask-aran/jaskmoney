import { copyFileSync, mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { TextRenderable } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { App } from "../app/App"
import { handleKey } from "../app/keys"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { keyEvent as key } from "../app/keyEvent"

/** Which text elements redraw for one key: `bun --conditions=browser src/bench/dirty.tsx <scenario>`. */
const scenario = process.argv[2] ?? "txns"
for (const name of ["JASKMONEY_UP_TOKEN", "JASKMONEY_JEV_TOKEN", "JASKMONEY_CF_TOKEN"]) process.env[name] = ""
process.env.JASKMONEY_DB = ":memory:"
process.env.JASKMONEY_NO_BOOTSTRAP = "1"
const dir = mkdtempSync(join(tmpdir(), "jaskmoney-dirty-"))
copyFileSync(process.env.JASKMONEY_BENCH_DB || join(homedir(), ".local/share/jaskmoney-opentui/transactions.db"), join(dir, "t.db"))
const t = await testRender(() => <App />, { width: 200, height: 55 })
data.init(join(dir, "t.db"))
data.setAccountSelection("all")
const keys: Record<string, () => ReturnType<typeof key>> = {
  txns: () => { ui.switchTab("manager"); ui.setState({ focusedSection: "mgr.transactions" }); return key("j") },
  overview: () => { ui.switchTab("overview"); ui.setState({ focusedSection: "ov.chart" }); return key("l") },
  merchants: () => { ui.switchTab("manager"); ui.setState({ focusedSection: "mgr.transactions" }); handleKey(ui, key("m"), data); return key("j") },
  pagedown: () => { ui.switchTab("manager"); ui.setState({ focusedSection: "mgr.transactions" }); return key("pagedown") },
  range: () => { ui.switchTab("overview"); ui.setState({ focusedSection: "ov.chart" }); return key("[") },
}
const press = keys[scenario]!()
await t.renderOnce()
handleKey(ui, press, data)
await t.renderOnce()
const proto = TextRenderable.prototype as unknown as Record<string, (...args: unknown[]) => unknown>
const updated: string[] = []
for (const method of Object.getOwnPropertyNames(proto)) {
  if (!/update|render|text/i.test(method) || method === "constructor") continue
  const desc = Object.getOwnPropertyDescriptor(proto, method)
  if (!desc || typeof desc.value !== "function") continue
  const original = desc.value
  proto[method] = function (this: { plainText?: string }, ...args: unknown[]) { updated.push(`${method}: ${String(this.plainText ?? "").slice(0, 60).replace(/\n/g, "⏎")}`); return original.apply(this, args) }
}
handleKey(ui, press, data)
await t.renderOnce()
const counts = new Map<string, number>()
for (const u of updated) counts.set(u.split(":")[0]!, (counts.get(u.split(":")[0]!) ?? 0) + 1)
console.log([...counts].map(([m, n]) => `${m} ×${n}`).join("  "))
const texts = new Map<string, number>()
for (const u of updated.filter((u) => u.startsWith("updateTextFromNodes"))) texts.set(u, (texts.get(u) ?? 0) + 1)
console.log([...texts].map(([u, n]) => `${n}× ${u}`).join("\n"))
t.renderer.destroy()
process.exit(0)
