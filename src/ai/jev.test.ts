import { describe, expect, test } from "bun:test"
import { createJevClient, hasJev, JEV_MODEL, JevError, jevRoute, judgeEach, readJevToken, type JevAnswer, type JevQuestion } from "./jev"

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
  test("the token comes from the environment", () => {
    expect(readJevToken({ JASKMONEY_JEV_TOKEN: " t " })).toBe("t")
    expect(() => readJevToken({})).toThrow("JASKMONEY_JEV_TOKEN")
    expect(hasJev({ JASKMONEY_JEV_TOKEN: " " })).toBe(false)
  })

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
    expect(JEV_MODEL).toBe("jev-1.14.0")
    expect(calls[0]).toEqual({ url: "https://api.typesafe.ai/v1/systemone", auth: `Bearer ${token}`, body: { model: JEV_MODEL, state: { search: "s" }, questions } })
  })

  test("errors carry the API's message with the token redacted; a missing answer is an error", async () => {
    const { jev } = client(() => Response.json({ detail: [{ msg: `bad key ${token}` }] }, { status: 422 }))
    const error = await jev.judge({ q: { type: "noul", instructions: "?" } }, "s").catch((e: unknown) => e)
    expect(error).toBeInstanceOf(JevError)
    expect((error as JevError).status).toBe(422)
    expect((error as Error).message).toBe("Jev: bad key [redacted]")
    const empty = client(() => Response.json({ answers: {} })).jev
    await expect(empty.judge({ q: { type: "noul", instructions: "?" } }, "s")).rejects.toThrow("no usable answer for q")
  })

  test("a rate limit is retried; a request that takes too long is abandoned", async () => {
    const { calls, jev } = client((_, attempt) => attempt === 1
      ? new Response("", { status: 429, headers: { "retry-after": "0" } })
      : Response.json({ answers: { q: { type: "noul", noul: 0.5 } } }))
    expect(await jev.judge({ q: { type: "noul", instructions: "?" } }, "s")).toEqual({ q: noul(0.5) })
    expect(calls).toHaveLength(2)
    const slow = createJevClient({ token, timeoutMs: 10, fetch: (_, init) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))
    }) })
    await expect(slow.judge({ q: { type: "noul", instructions: "?" } }, "s")).rejects.toThrow("timed out")
  })
})

describe("judgeEach", () => {
  const question = (n: number): JevQuestion => ({ type: "noul", instructions: `item ${n} ${"x".repeat(300)}` })

  test("packs items into as few requests as fit the budget; answers come back by item", async () => {
    const sizes: number[] = []
    const jev = { judge: async (qs: Record<string, JevQuestion>) => {
      sizes.push(Object.keys(qs).length)
      return Object.fromEntries(Object.entries(qs).map(([id, q]) => [id, noul(Number(String(q.instructions).split(" ")[1]) / 100)]))
    } }
    const got = new Map<number, JevAnswer>()
    await judgeEach(jev, Array.from({ length: 25 }, (_, i) => i), question, "state", { budget: 1200, onAnswers: (a) => a.forEach((v, k) => got.set(k, v)) })
    // ~115 estimated tokens a question: 10 fit a 1200 budget.
    expect(sizes).toEqual([10, 10, 5])
    expect(got.get(7)).toEqual(noul(0.07))
    expect(got.size).toBe(25)
    sizes.length = 0
    await judgeEach(jev, Array.from({ length: 25 }, (_, i) => i), question, "state")
    expect(sizes).toEqual([25])
  })

  test("a failed request is reported with its items and the rest still land; stops once inactive", async () => {
    let calls = 0
    const jev = { judge: async (qs: Record<string, JevQuestion>) => {
      if (++calls === 1) throw new Error("fake outage")
      return Object.fromEntries(Object.keys(qs).map((id) => [id, noul(1)]))
    } }
    const failed: number[][] = []
    const landed: number[] = []
    await judgeEach(jev, [1, 2, 3, 4], question, "s", { budget: 250, onError: (_, items) => failed.push(items), onAnswers: (a) => landed.push(...a.keys()) })
    expect(failed).toHaveLength(1)
    expect([...failed.flat(), ...landed].sort()).toEqual([1, 2, 3, 4])
    calls = 10
    let sent = 0
    await judgeEach({ judge: async (qs) => { sent++; return Object.fromEntries(Object.keys(qs).map((id) => [id, noul(1)])) } }, [1, 2, 3, 4], question, "s", { budget: 250, active: () => false })
    expect(sent).toBe(0)
  })
})

describe("Jev's route", () => {
  test("a TypeSafe key first, then OpenRouter's key, then its sign-in; else none", () => {
    expect(jevRoute({ JASKMONEY_JEV_TOKEN: " t ", JASKMONEY_OPENROUTER_TOKEN: "o" }, true)).toEqual({ provider: "typesafe", token: "t" })
    expect(jevRoute({ JASKMONEY_OPENROUTER_TOKEN: "o" }, true)).toEqual({ provider: "openrouter", token: "o" })
    expect(jevRoute({}, true)).toEqual({ provider: "openrouter" })
    expect(jevRoute({}, false)).toBeNull()
  })

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
