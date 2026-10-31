/**
 * `bun run server`: the core on its own, for clients to connect to (the
 * web app at its address, the TUI with `--connect`). JASKMONEY_DB picks the
 * database, JASKMONEY_PORT the port and JASKMONEY_SERVER_TOKEN the token
 * (otherwise one is made each start; the addresses printed carry it). It
 * doesn't sync with Up by itself yet: a connected TUI's sync runs here.
 */
import "../startup"
import { createCore } from "../core/core"
import { DEFAULT_PORT, serveCore } from "./serve"

const core = createCore()
core.open(process.env.JASKMONEY_DB)
const served = serveCore(core, { port: Number(process.env.JASKMONEY_PORT) || DEFAULT_PORT })
console.log(`jaskmoney core on ${core.state.dbPath}\n  web app: ${served.page}\n  TUI:     bun start --connect '${served.api}'`)
