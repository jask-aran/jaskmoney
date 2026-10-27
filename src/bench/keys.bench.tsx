import { test } from "bun:test"
import { copyFileSync, mkdtempSync, rmSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import type { KeyEvent } from "@opentui/core"
import { handleKey } from "../app/keys"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { renderApp } from "../testing/app"
import { key } from "../testing/keys"
import { testEnv } from "../testing/scoped"

/**
 * Key-to-frame cost of the common keys on every tab: each key handled,
 * then one frame drawn, on a copy of your database (or JASKMONEY_BENCH_DB),
 * with no network. Not part of `bun test`; run `bun run bench`. Prints
 * mean and worst milliseconds per key, slowest first. BENCH_ONLY=<text>
 * measures only the matching scenarios (e.g. for a CPU profile).
 */
const PRESSES = 30

test("key-to-frame cost", async () => {
  testEnv("JASKMONEY_UP_TOKEN", "")
  testEnv("JASKMONEY_JEV_TOKEN", "")
  testEnv("JASKMONEY_CF_TOKEN", "")
  const dir = mkdtempSync(join(tmpdir(), "jaskmoney-bench-"))
  const source = process.env.JASKMONEY_BENCH_DB || join(homedir(), ".local/share/jaskmoney-opentui/transactions.db")
  copyFileSync(source, join(dir, "t.db"))
  const t = await renderApp({ width: Number(process.env.BENCH_WIDTH ?? 200), height: Number(process.env.BENCH_HEIGHT ?? 55) })
  data.init(join(dir, "t.db"))
  data.setAccountSelection("all")
  await t.renderOnce()
  const results: { name: string; mean: number; worst: number }[] = []
  const press = async (k: KeyEvent) => { handleKey(ui, k, data); await t.renderOnce() }
  // BENCH_ONLY=text runs the scenarios whose names contain it (setups still run).
  const only = process.env.BENCH_ONLY
  async function measure(name: string, setup: () => void | Promise<void>, keys: KeyEvent[]) {
    await setup()
    if (only && !name.includes(only)) return
    await t.renderOnce()
    const times: number[] = []
    for (let i = 0; i < PRESSES; i++) {
      const k = keys[i % keys.length]!
      const start = performance.now()
      await press(k)
      times.push(performance.now() - start)
    }
    results.push({ name, mean: times.reduce((a, b) => a + b, 0) / times.length, worst: Math.max(...times) })
  }
  const txns = () => { ui.switchTab("manager"); ui.setState({ focusedSection: "mgr.transactions", selectedIds: {}, rangeSelecting: false, detailId: null }); data.clearFilter(); if (data.state.uncategorisedOnly) handleKey(ui, key("i"), data); ui.setState({ txnView: "rows" }) }
  const j = key("j"), k = key("k")

  await measure("overview: h/l chart", () => { ui.switchTab("overview"); ui.setState({ focusedSection: "ov.chart" }) }, [key("l"), key("h")])
  await measure("overview: [ ] range", () => {}, [key("["), key("]")])
  await measure("overview: d range chip", () => {}, [key("d")])
  await measure("tabs: 1 2 3", () => {}, [key("2"), key("3"), key("1")])
  await measure("txns: j/k", txns, [j, j, j, k])
  await measure("txns: pagedown/up", txns, [key("pagedown"), key("pageup")])
  await measure("txns: g/G", txns, [key("g", { shift: true, sequence: "G" }), key("g")])
  await measure("txns: space select + j", txns, [key("space"), j])
  await measure("txns: S-j range", txns, [key("j", { shift: true, sequence: "J" })])
  await measure("txns: type in filter", () => { txns(); handleKey(ui, key("/"), data) }, [..."coffeeshop"].map((c) => key(c)))
  await measure("txns: s sort", () => { handleKey(ui, key("escape"), data); txns() }, [key("s")])
  await measure("txns: a account", txns, [key("a")])
  await measure("uncategorised: j/k", () => { txns(); handleKey(ui, key("i"), data) }, [j, j, k])
  await measure("merchants: j/k", () => { txns(); handleKey(ui, key("m"), data) }, [j, j, k])
  await measure("detail: j/k", () => { txns(); handleKey(ui, key("return"), data) }, [j, k])
  await measure("category picker: type", () => { handleKey(ui, key("escape"), data); txns(); handleKey(ui, key("c"), data) }, [..."groceries"].map((c) => key(c)))
  await measure("palette: move", () => { handleKey(ui, key("escape"), data); txns(); handleKey(ui, key("k", { ctrl: true }), data) }, [key("down"), key("down"), key("up")])
  await measure("palette: type", () => {}, [..."rules"].map((c) => key(c)))
  await measure("settings: j/k sections", () => { handleKey(ui, key("escape"), data); ui.switchTab("settings") }, [j, j, k])
  await measure("settings: taxonomy j/k", () => { ui.activateSettings("taxonomy") }, [j, j, k])

  t.renderer.destroy()
  rmSync(dir, { recursive: true, force: true })
  console.log(`\n${data.state.transactions.length} rows\n` + results.sort((a, b) => b.mean - a.mean).map((r) => `${r.mean.toFixed(1).padStart(6)} ms  worst ${r.worst.toFixed(1).padStart(6)}  ${r.name}`).join("\n"))
}, 120_000)
