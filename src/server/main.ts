/**
 * `bun run server`: the core on its own, for clients to connect to (the
 * TUI with `--connect`). JASKMONEY_DB picks the
 * database and JASKMONEY_PORT the port. It doesn't sync with Up by itself
 * yet: a connected TUI's sync runs here.
 */
import "../startup"
import { createCore } from "../core/core"
import { DEFAULT_PORT, serveCore } from "./serve"

const core = createCore()
core.open(process.env.JASKMONEY_DB)
const served = serveCore(core, { port: Number(process.env.JASKMONEY_PORT) || DEFAULT_PORT })
console.log(`jaskmoney core on ${core.state.dbPath}\n  TUI: bun start --connect '${served.api}'`)
