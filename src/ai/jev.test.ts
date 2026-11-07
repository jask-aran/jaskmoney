import { describe, expect, test } from "bun:test"
import { createJevClient, JEV_MODEL, JevError, type JevAnswer, type JevQuestion } from "./jev"

const token = "apikey_secret_1234567890"

function client(respond: (body: Record<string, unknown>, attempt: number) => Response | Promise<Response>, timeoutMs?: number) {
  const calls: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = []
  const fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    calls.push({ url: String(input), body, auth: new Headers(init?.headers).get("Authorization") })
    return respond(body, calls.length)
  }
  return { calls, jev: createJevClient({ token, fetch, timeoutMs }) }
}
const noul = (p: number): JevAnswer => ({ type: "noul", noul: p })

describe("Jev client", () => {
  test("posts the pinned model, state and questions to api.typesafe.ai and returns typed answers", async () => {
    const { calls, jev } = client(() => Response.json({ model: JEV_MODEL, answers: {
      a: { type: "noul", noul: 0.9 },
      b: { type: "choice", choice: "x", probabilities: { x: 0.8, y: 0.2 }, confidence: 0.6 },
    }, usage: { input_tokens: 10, output_tokens: 2 } }))
    const questions: Record<string, JevQuestion> = {
      a: { type: "noul", instructions: { question: "Is `t` x?", t: { d: 1 } } },
      b: { type: "choice", instructions: "Which?", criteria: { x: "X", y: "Y" } },
    }
    expect(await jev.judge(questions, { search: "s" })).toEqual({
      a: { type: "noul", noul: 0.9 },
      b: { type: "choice", choice: "x", probabilities: { x: 0.8, y: 0.2 }, confidence: 0.6 },
    })
    expect(calls[0]).toEqual({ url: "https://api.typesafe.ai/v1/systemone", auth: `Bearer ${token}`, body: { model: JEV_MODEL, state: { search: "s" }, questions } })
  })

  test("errors carry the API's message with the token redacted; a missing answer is an error", async () => {
    const { jev } = client(() => Response.json({ detail: [{ msg: `bad key ${token}` }] }, { status: 422 }))
    const error = await jev.judge({ q: { type: "noul", instructions: "?" } }, "s").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(JevError)
    expect((error as JevError).status).toBe(422)
    expect((error as Error).message).toContain("bad key [redacted]")
    expect((error as Error).message).not.toContain(token)
    const empty = client(() => Response.json({ answers: {} })).jev
    await expect(empty.judge({ q: { type: "noul", instructions: "?" } }, "s")).rejects.toThrow()
  })
})

describe("Jev's route", () => {
  test("through OpenRouter, the pinned version goes to OpenRouter's System One endpoint", async () => {
    const calls: { url: string; auth: string | null; body: { model: string } }[] = []
    const fetch = (async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), auth: new Headers(init.headers).get("authorization"), body: JSON.parse(String(init.body)) })
      return new Response(JSON.stringify({ answers: { q: { type: "noul", noul: 0.9 } } }))
    }) as unknown as typeof globalThis.fetch
    const jev = createJevClient({ provider: "openrouter", token: "or-key", fetch })
    expect(await jev.judge({ q: { type: "noul", instructions: "?" } }, "s")).toEqual({ q: noul(0.9) })
    expect(calls[0]).toMatchObject({ url: "https://openrouter.ai/api/v1/systemone", auth: "Bearer or-key", body: { model: "typesafe/jev-1.14" } })
  })
})
