import type { Context } from "@earendil-works/pi-ai"
import { createJevClient, jevRoute } from "../ai/jev"
import { createWorkersAiClient } from "../ai/workersAi"
import { activeLlmProvider, LLM_PROVIDERS, llmModelId, llmModelInfo, type Llm } from "../ai/llm"
import { credentialEnv } from "../ai/credentials"
import { writeRules } from "../ai/ruleWriter"
import { judgeRows } from "../domain/ask"
import { appToday } from "../domain/days"
import { isOrdinaryFlow, isUncategorised } from "../domain/moneyRules"
import { smartSearch } from "../domain/smartSearch"
import { askMerchantBreadth, jevSuggestions, merchantBreadth } from "../domain/suggest"
import { jevTagCandidates, tagExamples, tagPool } from "../domain/tagSuggest"
import { newestFirst } from "../domain/chronology"
import type { Transaction } from "../domain/types"
import type { AiUse, QueryId } from "../ai/catalog"
import type { DataStore } from "../state/dataStore"

/**
 * Exactly what each use sends, built by running its real code with clients
 * that record the request and never send it: the same questions, state
 * and wording as a real run, for a sample row of yours (the newest one the
 * use would look at), at no cost. Keys and account ids are left out.
 */
export interface SentPart {
  query: QueryId
  /** Method and URL, or the model a prompt goes to. */
  to: string
  body: unknown
  /** What it was built for: "your newest waiting row (Amazon, -$54.90)". */
  sample: string
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
const rowSample = (what: string, t: Transaction) => `${what} (${t.description.trim()}, ${t.amount < 0 ? "-" : "+"}$${Math.abs(t.amount).toFixed(2)})`

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
      parts.push({ query: "suggestion", sample: rowSample("your newest waiting row", row), ...first(await captureJev((jev) => jevSuggestions(jev, [row], categories, { history: transactions, breadth, notes }))) })
      parts.push({ query: "merchantCheck", sample: `its merchant, ${row.description.trim()}`, ...first(await captureJev((jev) => askMerchantBreadth(jev, [row], { notes, onAnswers: () => {} }))) })
    }
    const tag = data.state.tags.find((t) => t.name.toUpperCase() !== "IGNORE")
    const target = tag && { tagId: tag.id, name: tag.name, categoryIds: tag.categoryIds, about: tag.about }
    // A row the tag would be asked about: in its scope, not tagged yet.
    const spend = target && tagPool(target, transactions, categories).sort(newestFirst)[0]
    if (tag && target && spend) {
      parts.push({ query: "tagFind", sample: rowSample(`your tag ${tag.name} and the newest row in its scope`, spend), ...first(await captureJev((jev) => jevTagCandidates(jev, target, [spend], tagExamples(target, transactions)))) })
    }
  }

  if (use === "search") {
    const question = options.smartQuestion ?? "coffee over $5 last month"
    const clairic = recorder()
    const jevSent = await captureJev((jev) => smartSearch({ jev, ...(options.clairic ? { clairic: createWorkersAiClient({ token: "preview", accountId: "ACCOUNT", fetch: clairic.fetch, timeoutMs: 5_000 }).clairic } : {}) },
      question, { today: appToday(), cycle: data.cycle(), categories, descriptions: [], uses: data.categoryUses() }))
    // The query's questions, then the category questions with your examples (smartSearch).
    const searched = `${options.smartQuestion ? "your last smart search" : "an example search"}, ?${question}`
    parts.push({ query: "searchTerms", sample: searched, ...first(jevSent) })
    parts.push({ query: "searchCategories", sample: searched, ...first(jevSent.slice(1)) })
    if (options.clairic) parts.push({ query: "clairic", sample: searched, ...first(clairic.sent.map((s) => ({ ...s, url: s.url.replace("/accounts/ACCOUNT/", "/accounts/<your account>/") }))) })
    const row = sampleRow(data, false)
    const words = options.askWords ?? "coffee"
    if (row) parts.push({ query: "ask", sample: rowSample(`ask:"${words}" and your newest spending`, row), ...first(await captureJev((jev) => judgeRows(jev, words, [row]))) })
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
    const { history, declined } = await data.ruleWriterInput()
    await writeRules(llm, history, { declined }).catch(() => {})
    const info = llmModelInfo(provider, modelId)
    parts.push({ query: "ruleWriter", sample: "your history now", to: info ? `POST ${info.baseUrl} (${info.api}, through pi-ai)` : `${LLM_PROVIDERS[provider].label} (through pi-ai)`, body: context })
  }
  return parts
}
