import type { TagPatch } from "./context"
import { type CoreProgress } from "./protocol"
import type { CoreRuntime } from "./runtime"
import type { CallContext } from "./core"

export class TransactionsCommands {
  constructor(private readonly ctx: CoreRuntime) {}
  transactionsCommands = {
    categorize: (p: { ids: number[]; categoryId: number }, cx: CallContext<CoreProgress["categorize"]>) =>
      this.ctx.push.categorizeTransactions(p.ids, p.categoryId, (pushed, total) => cx.progress({ pushed, total })),
    applyTagPatch: (p: { ids: number[]; patch: TagPatch; how?: "picker" | "review" | "undo" }) => this.ctx.push.applyTagPatch(p.ids, p.patch, p.how),
    retryPendingCategories: (_: object) => this.ctx.push.retryPendingCategories(),
    retryPendingTags: (_: object) => this.ctx.push.retryPendingTags()
  }
}
