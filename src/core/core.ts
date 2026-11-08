import type { Models } from "@earendil-works/pi-ai"
import type { JevClient } from "../ai/jev"
import type { Llm } from "../ai/llm"
import type { CoreState, CoreProgress } from "./protocol"
import { CoreRuntime } from "./runtime"
import { AiCommands } from "./aiCommands"
import { DataCommands } from "./dataCommands"
import { SyncCommands } from "./syncCommands"
import type { TagPatch } from "./context"
import { recordBudget, saveBudgetCycle } from "../db/client"
import { cycleFor, type BudgetScope, type CycleConfig } from "../domain/budget"
import { scopeKey } from "../domain/budgetScopes"
import { appToday } from "../domain/days"

class BudgetCommands {
  constructor(private readonly ctx: CoreRuntime) {}
  budgetCommands = {
    /** A budget from the cycle starting `from` (default this one) until its
     * next change. One first set in this cycle is recorded since always, so
     * it measures earlier cycles too. `replaces`: the budget this one was
     * (the editor changed what it covers) ends then, in the same write. */
    setBudget: (p: { scope: BudgetScope; amount: number; from?: string; replaces?: BudgetScope }) => {
      const now = cycleFor(this.ctx.cycle(), appToday()).start
      const fresh = !this.ctx.state.budgetHistory.some((e) => scopeKey(e.scope) === scopeKey(p.scope))
      this.ctx.mutate((db) => db.transaction(() => {
        if (p.replaces && scopeKey(p.replaces) !== scopeKey(p.scope)) recordBudget(db, p.replaces, null, p.from ?? now, now)
        recordBudget(db, p.scope, p.amount, fresh && (p.from ?? now) === now ? null : p.from ?? now, now)
      })())
    },
    /** No budget for `scope` from the cycle starting `from` (default this one). */
    removeBudget: (p: { scope: BudgetScope; from?: string }) => {
      const now = cycleFor(this.ctx.cycle(), appToday()).start
      this.ctx.mutate((db) => recordBudget(db, p.scope, null, p.from ?? now, now))
    },
    setBudgetCycle: (p: { config: CycleConfig }) => this.ctx.mutate((db) => saveBudgetCycle(db, p.config))
  }
}

class TransactionsCommands {
  constructor(private readonly ctx: CoreRuntime) {}
  transactionsCommands = {
    categorize: (p: { ids: number[]; categoryId: number }, cx: CallContext<CoreProgress["categorize"]>) =>
      this.ctx.push.categorizeTransactions(p.ids, p.categoryId, (pushed, total) => cx.progress({ pushed, total })),
    applyTagPatch: (p: { ids: number[]; patch: TagPatch; how?: "picker" | "review" | "undo" }) => this.ctx.push.applyTagPatch(p.ids, p.patch, p.how),
    retryPendingCategories: (_: object) => this.ctx.push.retryPendingCategories(),
    retryPendingTags: (_: object) => this.ctx.push.retryPendingTags()
  }
}

/**
 * The jaskmoney core: the one owner of the database, the settings file, the
 * credentials, Up and the models. Framework-free; clients (the TUI, the web
 * app) see it through `CoreState` patches and call its `commands` over a
 * link (client/link: in-process; server/serve: a WebSocket). See
 * core/protocol for the contract.
 */
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

export { CONFIG_SETTLE_MS, initialCoreState } from "./runtime"

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
