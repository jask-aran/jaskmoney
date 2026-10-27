import { createJevClient, JEV_MODEL, readJevToken } from "../ai/jev"
import { createWorkersAiClient, readWorkersAiCredentials } from "../ai/workersAi"
import { createLlm } from "../ai/llm"
import { appToday } from "../domain/days"
import type { UiStore } from "../state/uiStore"

/** The AI models pane's rows, in order. */
export const AI_ROWS = ["jev", "workersAi", "openRouter"] as const
export type AiRow = (typeof AI_ROWS)[number]

/** Try a key with the smallest possible request (a few tokens) and report. */
export async function testApiKey(ui: UiStore, row: AiRow): Promise<void> {
  ui.setStatus(row === "jev" ? "Testing the Jev key…" : row === "workersAi" ? "Testing the Workers AI key…" : "Testing the OpenRouter key…")
  let openRouterKey = ""
  try {
    if (row === "jev") {
      await createJevClient({ token: readJevToken(), timeoutMs: 15_000 }).judge({ ok: { type: "noul", instructions: "Is `state` a greeting?" } }, "hello")
      ui.setStatus(`Jev key works (${JEV_MODEL})`)
    } else if (row === "workersAi") {
      await createWorkersAiClient({ ...readWorkersAiCredentials(), timeoutMs: 15_000 }).clairic({ word: { type: "text" } }, "hello", appToday())
      ui.setStatus("Workers AI key works (Clairic)")
    } else {
      const llm = createLlm()
      openRouterKey = llm.apiKey ?? ""
      const reply = await llm.models.complete(llm.model, { messages: [{ role: "user", content: "Say ok.", timestamp: Date.now() }] }, { apiKey: llm.apiKey, signal: AbortSignal.timeout(30_000) })
      if (reply.stopReason === "error" || reply.stopReason === "aborted") throw new Error(reply.errorMessage)
      ui.setStatus(`OpenRouter key works (${llm.model.id})`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    ui.setStatus(openRouterKey ? message.replaceAll(openRouterKey, "[redacted]") : message, true)
  }
}
