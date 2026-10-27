import { copyFileSync, mkdtempSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { testRender } from "@opentui/solid"
import { App } from "../app/App"
import { handleKey } from "../app/keys"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { keyEvent as key } from "../app/keyEvent"

/**
 * One scenario for a CPU profile: `bun --cpu-prof --cpu-prof-dir=<dir>
 * --conditions=browser src/bench/profile.tsx <scenario>`, then read it with
 * src/bench/hot.ts. Scenarios: txns, overview, range, chip, account, tabs, detail.
 */
const scenario = process.argv[2] ?? "txns"
for (const name of ["JASKMONEY_UP_TOKEN", "JASKMONEY_JEV_TOKEN", "JASKMONEY_CF_TOKEN"]) process.env[name] = ""
process.env.JASKMONEY_DB = ":memory:"
process.env.JASKMONEY_NO_BOOTSTRAP = "1"
const dir = mkdtempSync(join(tmpdir(), "jaskmoney-prof-"))
copyFileSync(process.env.JASKMONEY_BENCH_DB || join(homedir(), ".local/share/jaskmoney-opentui/transactions.db"), join(dir, "t.db"))
const t = await testRender(() => <App />, { width: 200, height: 55 })
data.init(join(dir, "t.db"))
data.setAccountSelection("all")
const keys = {
  txns: () => { ui.switchTab("manager"); ui.setState({ focusedSection: "mgr.transactions" }); return [key("j"), key("j"), key("k")] },
  overview: () => { ui.switchTab("overview"); ui.setState({ focusedSection: "ov.chart" }); return [key("l"), key("h")] },
  range: () => { ui.switchTab("overview"); ui.setState({ focusedSection: "ov.chart" }); return [key("["), key("]")] },
  chip: () => { ui.switchTab("overview"); ui.setState({ focusedSection: "ov.chart" }); return [key("d")] },
  account: () => { ui.switchTab("manager"); ui.setState({ focusedSection: "mgr.transactions" }); return [key("a")] },
  tabs: () => [key("1"), key("2"), key("3")],
  detail: () => { ui.switchTab("manager"); ui.setState({ focusedSection: "mgr.transactions" }); handleKey(ui, key("return"), data); return [key("j"), key("k")] },
}[scenario]!()
await t.renderOnce()
let handling = 0, drawing = 0
for (let i = 0; i < 300; i++) {
  const a = performance.now()
  handleKey(ui, keys[i % keys.length]!, data)
  const b = performance.now()
  await t.renderOnce()
  handling += b - a
  drawing += performance.now() - b
}
console.log(`${scenario}: ${((handling + drawing) / 300).toFixed(1)} ms/key (key and updates ${(handling / 300).toFixed(1)}, frame ${(drawing / 300).toFixed(1)})`)
t.renderer.destroy()
process.exit(0)
