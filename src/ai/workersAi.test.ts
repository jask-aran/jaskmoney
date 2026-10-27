import { describe, expect, test } from "bun:test"
import { createWorkersAiClient, hasWorkersAi, readWorkersAiCredentials, WorkersAiError } from "./workersAi"

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
  test("credentials come from the environment, both required", () => {
    expect(readWorkersAiCredentials({ JASKMONEY_CF_TOKEN: " t ", JASKMONEY_CF_ACCOUNT_ID: "a" })).toEqual({ token: "t", accountId: "a" })
    expect(() => readWorkersAiCredentials({ JASKMONEY_CF_TOKEN: "t" })).toThrow("JASKMONEY_CF_ACCOUNT_ID")
    expect(hasWorkersAi({ JASKMONEY_CF_TOKEN: "t", JASKMONEY_CF_ACCOUNT_ID: " " })).toBe(false)
  })

  test("Clairic: sends the reference date; keeps value and confidence, not the guess", async () => {
    const { calls, ai } = client(() => ok({
      words: { type: "text", value: "coffee", span: [0, 6], confidence: 0.99, p_null: 0.01, guess: "coffee" },
      at_least: { type: "number", value: null, p_null: 0.98, guess: 5, confidence: 0.2 },
    }))
    const answers = await ai.clairic({ words: { type: "text" }, at_least: { type: "number", decimals: 2 } }, "coffee", "2026-10-27")
    expect(answers).toEqual({ words: { value: "coffee", confidence: 0.99 }, at_least: { value: null, confidence: 0.2 } })
    expect(calls[0]!.body).toMatchObject({ model: "clairic", reference_date: "2026-10-27" })
  })

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
    await expect(ai.clairic({ q: { type: "text" } }, "s", "2026-10-27")).rejects.toThrow("no usable answer for q")
  })

  test("a request that takes too long is abandoned", async () => {
    const fetch = (_: string | URL | Request, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))
    })
    const ai = createWorkersAiClient({ token, accountId, fetch, timeoutMs: 10 })
    await expect(ai.clairic({ q: { type: "text" } }, "s", "2026-10-27")).rejects.toThrow("timed out")
  })
})

test("Cloudflare's errors read plainly", async () => {
  const { plainError } = await import("./workersAi")
  expect(plainError("AiError: AiError: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan")).toBe("free daily limit used up")
  expect(plainError("AiError: AiError: bad input")).toBe("bad input")
  expect(plainError("plain")).toBe("plain")
})
