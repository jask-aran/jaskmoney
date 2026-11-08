import { recordBudget, saveBudgetCycle } from "../db/client"
import { cycleFor, type BudgetScope, type CycleConfig } from "../domain/budget"
import { scopeKey } from "../domain/budgetScopes"
import { appToday } from "../domain/days"
import type { CoreRuntime } from "./runtime"

export class BudgetCommands {
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
