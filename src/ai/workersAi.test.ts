import { describe, expect, test } from "bun:test"
import { createWorkersAiClient, WorkersAiError } from "./workersAi"

const token = "secret-token-1234567890"
const accountId = "acct-0987654321"

function client(respond: (url: string, body: Record<string, unknown>) => Response | Promise<Response>, timeoutMs?: number) {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({ url: String(input), body, auth: new Headers(init?.headers).get("Authorization") })
    return respond(String(input), body)
  }
  return { calls, ai: createWorkersAiClient({ token, accountId, fetch, timeoutMs }) }
}

const ok = (answers: unknown) => Response.json({ result: { model: "x", answers }, success: true, errors: [], messages: [] })

describe("Workers AI client", () => {
  test("errors carry the API's message with the token and account redacted", async () => {
    const { ai } = client(() => Response.json({ success: false, errors: [{ message: `bad token ${token} for ${accountId}` }] }, { status: 401 }))
    const error = await ai.clairic({ q: { type: "text" } }, "s", "2026-10-27").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WorkersAiError)
    expect((error as WorkersAiError).status).toBe(401)
    expect(String((error as Error).message)).not.toContain(token)
    expect(String((error as Error).message)).not.toContain(accountId)
  })

  test("a missing or malformed answer is an error, not a silent gap", async () => {
    const { ai } = client(() => ok({ q: { type: "text", value: { nested: true } } }))
    await expect(ai.clairic({ q: { type: "text" } }, "s", "2026-10-27")).rejects.toThrow()
  })
})
