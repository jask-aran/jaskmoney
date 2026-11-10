import "../startup"
import { createCore } from "../core/core"
import { DEFAULT_PORT, serveCore } from "./serve"

const core = createCore()
core.open(process.env.JASKMONEY_DB)
const served = serveCore(core, { port: Number(process.env.JASKMONEY_PORT) || DEFAULT_PORT })
console.log(`jaskmoney core on ${core.state.dbPath}\n  TUI: bun start --connect '${served.api}'`)
