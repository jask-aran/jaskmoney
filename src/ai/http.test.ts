import { expect, test } from "bun:test"
import { fetchWithTimeout, type Fetch } from "./http"

test("deadline covers stalled headers and stalled bodies", async () => {
  for (const headers of [false, true]) {
    let signal: AbortSignal | null | undefined
    const fetch: Fetch = async (_, init) => {
      signal = init?.signal
      if (!headers) return new Promise<Response>((_, reject) => {
        signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      })
      return new Response(new ReadableStream({ start(controller) {
        signal?.addEventListener("abort", () => controller.error(new DOMException("aborted", "AbortError")))
      } }))
    }
    await expect(fetchWithTimeout(fetch, "https://test.invalid", {}, 10)).rejects.toThrow("aborted")
    expect(signal?.aborted).toBe(true)
  }
})

test("completed bodies remain readable and release the timer", async () => {
  let signal: AbortSignal | null | undefined
  const fetch: Fetch = async (_, init) => {
    signal = init?.signal
    return new Response(' {"ok":true} ', { status: 201, headers: { "X-Test": "kept" } })
  }
  const response = await fetchWithTimeout(fetch, "https://test.invalid", {}, 10)
  await Bun.sleep(20)
  expect(signal?.aborted).toBe(false)
  expect(response.status).toBe(201)
  expect(response.headers.get("X-Test")).toBe("kept")
  expect(await response.json()).toEqual({ ok: true })
})
