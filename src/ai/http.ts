export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** A request aborted after `timeoutMs` (an AbortError); reading the body stays with the caller. */
export async function fetchWithTimeout(fetch: Fetch, input: string | URL | Request, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}
