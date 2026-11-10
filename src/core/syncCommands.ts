import { syncUp as runUpSync } from "../up/sync"
import { createLane } from "./lane"
import type { CoreRuntime } from "./runtime"

const breathe = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

export class SyncCommands {
  private readonly upSync: ReturnType<typeof createLane>

  constructor(private readonly ctx: CoreRuntime) {
    this.upSync = createLane({ state: ctx.state, set: ctx.set }, "upSyncing", "Up sync is already running")
  }

  syncUp = (off?: string[]): Promise<string> => {
    if (this.ctx.state.demo) return Promise.reject(new Error("Sync is off in demo mode"))
    return this.upSync.run(() => this.syncNow(off))
  }

  syncNow = async (off?: string[]): Promise<string> => {
    const session = this.ctx.session()
    const confirmed = this.ctx.push.watchUpWrites()
    const result = await runUpSync(session.db, this.ctx.upClient(), { keep: confirmed.ids, ensureCurrent: () => this.ctx.ensureCurrent(session, "Up sync was running"), ...(off ? { off: new Set(off) } : {}) }).catch((error: unknown) => {
      try { if (this.ctx.isCurrent(session)) this.ctx.refresh() } catch {}
      throw error
    }).finally(confirmed.stop)
    await breathe()
    this.ctx.ensureCurrent(session, "Up sync was running")
    this.ctx.refresh(result.inserted || result.updated || result.removedHeld ? undefined : [])
    await breathe()
    this.ctx.ensureCurrent(session, "Up sync was running")
    const applied = result.insertedIds.length ? this.ctx.settings.applyRules(result.insertedIds) : null
    const retried = await this.ctx.push.retryPendingCategories()
    this.ctx.ensureCurrent(session, "Up sync was running")
    const tagsRetried = await this.ctx.push.retryPendingTags()
    this.ctx.ensureCurrent(session, "Up sync was running")
    const parts = [`Up sync: ${result.inserted} new, ${result.updated} updated, ${result.removedHeld} pending removed${applied?.updatedTransactions ? ` · ${applied.updatedTransactions} rules applied` : ""}`]
    if (retried.pushed) parts.push(`${retried.pushed} waiting categor${retried.pushed === 1 ? "y" : "ies"} sent to Up`)
    if (retried.rejected) parts.push(`${retried.rejected} Up refused (kept here only)`)
    if (retried.waiting) parts.push(`${retried.waiting} still waiting for Up`)
    if (tagsRetried.pushed) parts.push(`${tagsRetried.pushed} waiting tag changes sent to Up`)
    if (tagsRetried.rejected) parts.push(`${tagsRetried.rejected} tag changes Up refused (reverted here)`)
    if (tagsRetried.waiting) parts.push(`${tagsRetried.waiting} tag changes still waiting for Up`)
    return parts.join(" · ")
  }
  syncCommands = {
    syncUp: (p: { off?: string[] }) => this.syncUp(p.off)
  }
}
