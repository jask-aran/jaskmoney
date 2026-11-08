/**
 * The jaskmoney core: the one owner of the database, the settings file, the
 * credentials, Up and the models. Framework-free; clients (the TUI, the web
 * app) see it through `CoreState` patches and call its `commands` over a
 * link (client/link: in-process; server/serve: a WebSocket). See
 * core/protocol for the contract.
 */
import type { Models } from "@earendil-works/pi-ai"
import type { JevClient } from "../ai/jev"
import type { Llm } from "../ai/llm"
import type { CoreState } from "./protocol"
import { CoreRuntime } from "./runtime"
import { TransactionsCommands } from "./transactionsCommands"
import { AiCommands } from "./aiCommands"
import { DataCommands } from "./dataCommands"
import { SyncCommands } from "./syncCommands"
import { BudgetCommands } from "./budgetCommands"

/** How a command hears about the call it serves. */
export interface CallContext<P = never> {
  progress: (data: P) => void
  signal: AbortSignal
  /** In-process links only (tests): a Jev client or general model in place
   * of the real ones. */
  ai?: Pick<JevClient, "judge">
  llm?: Llm
  models?: Pick<Models, "login">
}

export { CONFIG_SETTLE_MS, initialCoreState } from "./coreState"

export function createCore() {
  const ctx = new CoreRuntime()
  const transactions = new TransactionsCommands(ctx)
  const ai = new AiCommands(ctx)
  const data: DataCommands = new DataCommands(ctx, () => commands)
  const sync = new SyncCommands(ctx)
  const budget = new BudgetCommands(ctx)
  /**
   * Everything a client can ask of the core. Each takes one params object
   * (JSON over the wire) and, where it needs one, the call's context.
   */
  const commands = {
    ...ctx.demoCommands,
    ...transactions.transactionsCommands,
    ...ai.suggestionsCommands,
    ...ai.searchCommands,
    ...ai.credentialsCommands,
    ...ctx.settings.settingsCommands,
    ...data.importsCommands,
    ...sync.syncCommands,
    ...data.accountsCommands,
    ...budget.budgetCommands,
    ...data.clearCommands,
    ...ai.rulesCommands,
  }

  return {
    state: ctx.state as Readonly<CoreState>,
    subscribe: ctx.subscribe,
    commands,
    open: ctx.open,
    close: ctx.close,
    dispose: ctx.dispose,
    refresh: ctx.refresh,
    /** Test seams (in-process only): write the state, reach the database. */
    set: ctx.set,
    get db() { return ctx.db },
  }
}

export type Core = ReturnType<typeof createCore>
export type CoreCommands = Core["commands"]
