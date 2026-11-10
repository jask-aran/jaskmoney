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
    setBudget: (p: { scope: BudgetScope; amount: number; from?: string; replaces?: BudgetScope }) => {
      const now = cycleFor(this.ctx.cycle(), appToday()).start
      const fresh = !this.ctx.state.budgetHistory.some((e) => scopeKey(e.scope) === scopeKey(p.scope))
      this.ctx.mutate((db) => db.transaction(() => {
        if (p.replaces && scopeKey(p.replaces) !== scopeKey(p.scope)) recordBudget(db, p.replaces, null, p.from ?? now, now)
        recordBudget(db, p.scope, p.amount, fresh && (p.from ?? now) === now ? null : p.from ?? now, now)
      })())
    },
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

export interface CallContext<P = never> {
  progress: (data: P) => void
  signal: AbortSignal
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
  const commands = {
    ...ctx.runtimeCommands,
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
    set: ctx.set,
    get db() { return ctx.db },
  }
}

export type Core = ReturnType<typeof createCore>
export type CoreCommands = Core["commands"]
