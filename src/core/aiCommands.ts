import { loadTransactionDetail, setTransactionNotes, loadRuleDeclines } from "../db/client"
import { credentialEnv, saveCredentials, type CredentialName } from "../ai/credentials"
import { isOrdinaryFlow, isUncategorised } from "../domain/moneyRules"
import { hasJev, jevClient, JEV_SETUP, type JevClient } from "../ai/jev"
import { llmModels, LLM_PROVIDERS, type LlmProvider } from "../ai/llm"
import { cloudflare, createWorkersAiClient, readWorkersAiCredentials, searchUsesClairic } from "../ai/workersAi"
import { smartSearch } from "../domain/smartSearch"
import { categoryUses, merchantBreadth } from "../domain/suggest"
import { createFileCredentialStore, installationId } from "../ai/oauthStore"
import { appToday } from "../domain/days"
import type { TagCandidate, TagTarget } from "../domain/tagSuggest"
import type { RuleOffer } from "../domain/ruleOffers"
import type { PurchaseLookup } from "../db/client"
import { type CoreProgress } from "./protocol"
import type { CoreRuntime } from "./runtime"
import { keyState } from "./coreState"
import type { CallContext } from "./core"

export class AiCommands {
  constructor(private readonly ctx: CoreRuntime) {}
  // Prompts stay in the core; clients send only the pasted code.
  signIns = new Map<LlmProvider, { paste: ((value: string) => void) | null }>()

  /** Save a row's note. A waiting row's suggestion is asked again with it
   * (Jev reads it as your_note; saving again re-asks, for a note written
   * before this); resolves to whether it was. */
  updateTransactionNotes = (id: number, notes: string, ai?: Pick<JevClient, "judge">): Promise<boolean> => {
    this.ctx.mutate((db) => setTransactionNotes(db, id, notes))
    const t = this.ctx.transactions().find((row) => row.id === id)
    if (!t || !t.notes.trim() || !this.ctx.state.suggestions[id] || !isOrdinaryFlow(t) || !isUncategorised(t) || (!ai && !hasJev())) return Promise.resolve(false)
    return this.ctx.suggestions.askAgain([id], ai).then(() => true, () => false)
  }
  suggestionsCommands = {
    suggestCategories: (p: { ids?: number[]; replace?: boolean }, cx: CallContext): Promise<string | number> =>
      p.replace ? this.ctx.suggestions.suggestCategories(p.ids ?? [], cx.ai, { replace: true }) : this.ctx.suggestions.suggestCategories(p.ids, cx.ai),
    resuggestLike: (p: { ids: number[] }, cx: CallContext) => this.ctx.suggestions.resuggestLike(p.ids, cx.ai),
    setMerchantNote: (p: { description: string; note: string }, cx: CallContext) => this.ctx.suggestions.setMerchantNote(p.description, p.note, cx.ai),
    /** `session`: the one the lookups were made for (CoreState.session). */
    recordPurchases: (p: { lookups: PurchaseLookup[]; session?: number }, cx: CallContext) => this.ctx.suggestions.recordPurchases(p.lookups, cx.ai, p.session),
    acceptSuggestions: (p: { ids: number[] }, cx: CallContext<CoreProgress["acceptSuggestions"]>) =>
      this.ctx.suggestions.acceptSuggestions(p.ids, (pushed, total) => cx.progress({ pushed, total })),
    dismissSuggestions: (p: { ids: number[] }) => this.ctx.suggestions.dismissSuggestions(p.ids),
    updateTransactionNotes: (p: { id: number; notes: string }, cx: CallContext) => this.updateTransactionNotes(p.id, p.notes, cx.ai),
    transactionDetail: (p: { id: number }) => this.ctx.db ? loadTransactionDetail(this.ctx.db, p.id) : null
  }
  searchCommands = {
    /** A filter expression written from `query` (domain/smartSearch), with
     * the words found among `descriptions` (the client's rows). */
    smartSearch: async (p: { query: string; descriptions: string[] }) => {
      const session = this.ctx.current
      if (!hasJev()) throw new Error(`Smart search needs Jev (${JEV_SETUP})`)
      const clairicOn = searchUsesClairic()
      const ai = { clairic: clairicOn ? createWorkersAiClient(readWorkersAiCredentials()).clairic : undefined, jev: jevClient() }
      const uses = categoryUses(this.ctx.transactions(), this.ctx.state.categories, merchantBreadth(this.ctx.transactions(), this.ctx.state.categories, new Map(Object.entries(this.ctx.state.merchantBreadth))))
      const { expr, clairic } = await smartSearch(ai, p.query, { today: appToday(), cycle: this.ctx.cycle(), categories: this.ctx.state.categories, descriptions: p.descriptions, uses })
      if (this.ctx.current !== session) throw new Error("The database changed while the filter was written; nothing more was saved")
      return { expr, clairic, clairicOn }
    },
    judgeAsk: (p: { words: string; ids: number[] }, cx: CallContext<CoreProgress["judgeAsk"]>) =>
      this.ctx.suggestions.judgeAsk(p.words, p.ids, cx.ai, { onJudged: cx.progress, active: () => !cx.signal.aborted }),
    tagCandidates: (p: { target: TagTarget }, cx: CallContext<CoreProgress["tagCandidates"]>) => {
      const run = this.ctx.tagCandidatesFor.run
      return this.ctx.tagReview.tagCandidates(p.target, cx.ai, { onCandidates: cx.progress, active: () => !cx.signal.aborted && run === this.ctx.tagCandidatesFor.run })
    },
    dismissTagCandidates: (p: { tag: string; candidates: TagCandidate[]; review: number }) => this.ctx.tagReview.dismissTagCandidates(p.tag, p.candidates, p.review)
  }
  credentialsCommands = {
    saveApiKeys: (p: { patch: Partial<Record<CredentialName, string | null>> }) => { saveCredentials(p.patch); this.ctx.set(keyState()) },
    /** Clairic's account from its saved token (cloudflareAccounts): saved
     * when the token reaches exactly one; else how many it reaches. */
    findCloudflareAccount: async (_: object): Promise<{ name: string } | { count: number }> => {
      const token = credentialEnv().JASKMONEY_CF_TOKEN?.trim()
      if (!token) throw new Error("Save the API token first")
      const accounts = await cloudflare.accounts(token)
      if (accounts.length !== 1) return { count: accounts.length }
      saveCredentials({ JASKMONEY_CF_ACCOUNT_ID: accounts[0]!.id })
      this.ctx.set(keyState())
      return { name: accounts[0]!.name }
    },
    /** After a sign-in or sign-out. */
    refreshApiKeys: (_: object) => this.ctx.set(keyState()),

    signInLlm: async (p: { provider: LlmProvider }, cx: CallContext<CoreProgress["signInLlm"]>) => {
      const on = this.ctx.current
      const { provider } = p
      const { label, signIn } = LLM_PROVIDERS[provider]
      if (this.signIns.has(provider)) throw new Error(`${label} sign-in is already running`)
      cx.signal.throwIfAborted()
      const run: { paste: ((value: string) => void) | null } = { paste: null }
      this.signIns.set(provider, run)
      let view: CoreProgress["signInLlm"] = { url: null, message: `${signIn}…`, paste: null }
      const report = (patch: Partial<typeof view>) => { view = { ...view, ...patch }; cx.progress(view) }
      let cleanup = () => {}
      try {
        const models = cx.models ?? llmModels()
        await models.login(provider, "oauth", {
          signal: cx.signal,
          notify: (event) => {
            if (event.type === "auth_url") report({ url: event.url, message: "Your browser should open; finish signing in there." })
            else if (event.type === "device_code") report({ url: event.verificationUri, message: `Enter the code ${event.userCode} at the address below.` })
            else report({ message: event.message })
          },
          prompt: (prompt) => new Promise<string>((resolve, reject) => {
            if (prompt.type === "select") { reject(new Error(`${label} asked a question this app can't show: ${prompt.message}`)); return }
            // The callback won the race: the paste field goes.
            const abort = () => { cleanup(); report({ paste: null }); reject(new Error("callback received")) }
            const cancel = () => { cleanup(); report({ paste: null }); reject(new Error("cancelled")) }
            cleanup = () => {
              run.paste = null
              prompt.signal?.removeEventListener("abort", abort)
              cx.signal.removeEventListener("abort", cancel)
            }
            run.paste = (value) => { cleanup(); report({ paste: null, message: "Checking…" }); resolve(value) }
            prompt.signal?.addEventListener("abort", abort, { once: true })
            cx.signal.addEventListener("abort", cancel, { once: true })
            if (cx.signal.aborted) cancel()
            else if (prompt.signal?.aborted) abort()
            else report({ paste: prompt.message })
          }),
        }, { getDeviceId: installationId, agentName: "jaskmoney" })
        if (this.ctx.current !== on) return
        this.ctx.set(keyState())
      } finally {
        cleanup()
        this.signIns.delete(provider)
      }
    },
    signInPaste: (p: { provider: LlmProvider; value: string }): boolean => {
      const paste = this.signIns.get(p.provider)?.paste
      if (!paste) return false
      paste(p.value)
      return true
    },
    signOutLlm: async (p: { provider: LlmProvider }) => {
      const on = this.ctx.current
      await createFileCredentialStore().delete(p.provider)
      if (this.ctx.current !== on) return
      this.ctx.set(keyState())
    }
  }
  rulesCommands = {
    /** What the general model reads to write rules (ai/ruleWriter), and the
     * rules declined so far. */
    ruleWriterInput: (_: object) => {
      const { categorySources, ...history } = this.ctx.ruleOffers.historyData()
      return { history: { ...history, categorySources: categorySources ? [...categorySources] : undefined }, declined: this.ctx.db ? loadRuleDeclines(this.ctx.db) : [] }
    },
    askForRules: (p: { focus?: string }, cx: CallContext) => this.ctx.ruleOffers.askForRules(cx.llm, p.focus),
    makeOfferedRule: (p: { offer: RuleOffer }) => this.ctx.ruleOffers.makeOfferedRule(p.offer),
    declineRuleOffer: (p: { offer: RuleOffer }) => this.ctx.ruleOffers.declineRuleOffer(p.offer)
  }
}
