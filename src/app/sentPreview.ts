import type { Context } from "@earendil-works/pi-ai"
import { createJevClient, jevRoute } from "../ai/jev"
import { createWorkersAiClient } from "../ai/workersAi"
import { activeLlmProvider, LLM_PROVIDERS, llmModelId, type Llm } from "../ai/llm"
import { credentialEnv } from "../ai/credentials"
import { writeRules } from "../ai/ruleWriter"
import { loadRuleDeclines } from "../db/client"
import { judgeRows } from "../domain/ask"
import { appToday } from "../domain/days"
import { isOrdinaryFlow, isUncategorised } from "../domain/moneyRules"
import { smartSearch } from "../domain/smartSearch"
import { askMerchantBreadth, jevSuggestions, merchantBreadth } from "../domain/suggest"
import { jevTagCandidates, tagExamples, tagPool } from "../domain/tagSuggest"
import { newestFirst } from "../domain/chronology"
import type { Transaction } from "../domain/types"
import type { AiUse } from "../state/aiDialog"
import type { DataStore } from "../state/dataStore"

/**
 * Exactly what each use sends, built by running its real code with clients
 * that record the request and never send it: the same questions, state
 * and wording as a real run, for a sample row of yours (the newest one the
 * use would look at), at no cost. Keys and account ids are left out.
 */
export interface SentPart {
  title: string
  /** When it's sent, and how many of it. */
  when: string
  /** Method and URL, or the model a prompt goes to. */
  to: string
  body: unknown
}

/** A fetch that records each request and answers with an error, so nothing
 * else happens. */
function recorder(): { fetch: typeof globalThis.fetch; sent: Array<{ url: string; body: unknown }> } {
  const sent: Array<{ url: string; body: unknown }> = []
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const raw = init?.body ? String(init.body) : ""
    let body: unknown = raw
    try { body = JSON.parse(raw) } catch { /* not JSON */ }
    sent.push({ url: String(url), body })
    return new Response('{"detail":"preview: not sent"}', { status: 400 })
  }) as unknown as typeof globalThis.fetch
  return { fetch, sent }
}

/** Run `go` with a recording Jev client; the requests it would have sent. */
async function captureJev(go: (jev: ReturnType<typeof createJevClient>) => Promise<unknown>): Promise<Array<{ url: string; body: unknown }>> {
  const { fetch, sent } = recorder()
  const jev = createJevClient({ token: "preview", provider: jevRoute()?.provider ?? "typesafe", fetch, timeoutMs: 5_000 })
  await go(jev).catch(() => {})
  return sent
}

const first = (sent: Array<{ url: string; body: unknown }>) => sent[0] ? { to: `POST ${sent[0].url}`, body: sent[0].body } : { to: "(nothing would be sent)", body: null }

/** The row a use would look at first: the newest waiting one, else the newest spending. */
function sampleRow(data: DataStore, waiting: boolean): Transaction | undefined {
  const rows = [...data.transactions()].sort(newestFirst)
  return (waiting ? rows.find((t) => isOrdinaryFlow(t) && isUncategorised(t)) : undefined) ?? rows.find((t) => t.amount < 0)
}

export async function previewSent(use: AiUse, data: DataStore, options: { smartQuestion?: string; askWords?: string; clairic: boolean }): Promise<SentPart[]> {
  const transactions = data.transactions()
  const categories = data.state.categories
  const breadth = merchantBreadth(transactions, categories, new Map(Object.entries(data.state.merchantBreadth)))
  const notes = new Map(Object.entries(data.state.merchantNotes))
  const parts: SentPart[] = []

  if (use === "suggestions") {
    const row = sampleRow(data, true)
    if (row) {
      parts.push({ title: "Category suggestion", when: "for each waiting row with no suggestion: after each sync and when you open i; one question per row, as many rows a request as fit", ...first(await captureJev((jev) => jevSuggestions(jev, [row], categories, { history: transactions, breadth, notes }))) })
      parts.push({ title: "Merchant check", when: "once per merchant name, before its rows are suggested (asked again when you change its note)", ...first(await captureJev((jev) => askMerchantBreadth(jev, [row], { notes, onAnswers: () => {} }))) })
    }
    const tag = data.state.tags.find((t) => t.name.toUpperCase() !== "IGNORE")
    const target = tag && { tagId: tag.id, name: tag.name, categoryIds: tag.categoryIds, about: tag.about }
    // A row the tag would be asked about: in its scope, not tagged yet.
    const spend = target && tagPool(target, transactions, categories).sort(newestFirst)[0]
    if (tag && target && spend) {
      parts.push({ title: `Finding a tag's transactions (T, ${tag.name})`, when: "when you choose a tag with T: one question per row in its scope, newest first", ...first(await captureJev((jev) => jevTagCandidates(jev, target, [spend], tagExamples(target, transactions)))) })
    }
  }

  if (use === "search") {
    const question = options.smartQuestion ?? "coffee over $5 last month"
    const clairic = recorder()
    const jevSent = await captureJev((jev) => smartSearch({ jev, ...(options.clairic ? { clairic: createWorkersAiClient({ token: "preview", accountId: "ACCOUNT", fetch: clairic.fetch, timeoutMs: 5_000 }).clairic } : {}) },
      question, { today: appToday(), cycle: data.cycle(), categories, descriptions: [] }))
    parts.push({ title: `Smart search (?${question})`, when: "once per smart search, Jev and Clairic at the same time; the answers are put together into JQL here, not by the models", ...first(jevSent) })
    if (options.clairic) parts.push({ title: "Smart search: Clairic", when: "with the Jev request above", ...first(clairic.sent.map((s) => ({ ...s, url: s.url.replace("/accounts/ACCOUNT/", "/accounts/<your account>/") }))) })
    const row = sampleRow(data, false)
    const words = options.askWords ?? "coffee"
    if (row) parts.push({ title: `ask:"${words}"`, when: "for each row an ask: term could match (in its categories, the last 90 days unless date: says): one question per row, many rows a request", ...first(await captureJev((jev) => judgeRows(jev, words, [row]))) })
  }

  if (use === "rules") {
    const provider = activeLlmProvider(credentialEnv())
    const modelId = llmModelId(credentialEnv(), provider)
    // pi-ai's request, as the provider gets it: its own fields (timestamps) left out.
    let context: unknown = null
    const llm = {
      model: { id: modelId },
      models: {
        completeSimple: async (_model: unknown, sent: Context) => {
          context = structuredClone({ system: sent.systemPrompt, messages: sent.messages.map((m) => ({ role: m.role, content: m.content })), tools: sent.tools })
          throw new Error("preview: not sent")
        },
      },
    } as unknown as Llm
    const db = data.getDb()
    await writeRules(llm, data.historyData(), { declined: db ? loadRuleDeclines(db) : [] }).catch(() => {})
    parts.push({ title: "Writing rules", when: "when you press a in the rules list (R): this first request, then one per turn as the model looks things up with the tools, up to 14 turns", to: `${LLM_PROVIDERS[provider].label} · ${modelId} (through pi-ai)`, body: context })
  }
  return parts
}
