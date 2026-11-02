export type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

/** Buffer the body under the same deadline, leaving the response readable by the caller. */
export async function fetchWithTimeout(fetch: Fetch, input: string | URL | Request, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    await response.clone().arrayBuffer()
    return response
  } finally {
    clearTimeout(timer)
  }
}
