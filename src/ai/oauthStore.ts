import { randomUUID } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai"
import { writeJsonAtomic } from "../storage/json"
import { defaultSettingsConfigPath } from "../state/settingsConfig"

/**
 * Browser sign-ins (OpenRouter, ChatGPT), kept by pi-ai's provider id in
 * oauth.json beside settings.json, owner-only (mode 600). pi-ai writes
 * through `modify` (login, token refresh); writes to the file are
 * serialized. Never rendered: the app only asks whether a provider is signed in.
 */
export function oauthPath(): string {
  return join(dirname(defaultSettingsConfigPath()), "oauth.json")
}

function readAll(path: string): Record<string, Credential> {
  if (!existsSync(path)) return {}
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"))
    return typeof raw === "object" && raw !== null ? (raw as Record<string, Credential>) : {}
  } catch {
    return {}
  }
}

function writeAll(path: string, all: Record<string, Credential>): void {
  writeJsonAtomic(path, all)
}

/**
 * This installation's ID, made on first use and the same ever after (a file
 * beside oauth.json): Sign in with ChatGPT sends it to OpenAI as the agent
 * host's ID, and refuses to start without one.
 */
export function installationId(path = join(dirname(oauthPath()), "installation-id")): string {
  const kept = existsSync(path) ? readFileSync(path, "utf8").trim() : ""
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(kept)) return kept
  const id = randomUUID()
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
  writeFileSync(path, `${id}\n`, { mode: 0o600 })
  return id
}

/** Whether a provider has a stored sign-in (sync: for rows and hints). */
export function signedIn(providerId: string, path = oauthPath()): boolean {
  return readAll(path)[providerId]?.type === "oauth"
}

/** One write at a time per file, across every store on it: each model
 * client makes its own store, and two token refreshes at once would each
 * write the file read before the other's. */
const chains = new Map<string, Promise<unknown>>()
function serial<T>(path: string, task: () => Promise<T>): Promise<T> {
  const next = (chains.get(path) ?? Promise.resolve()).then(task, task)
  const settled = next.catch(() => undefined)
  chains.set(path, settled)
  void settled.then(() => { if (chains.get(path) === settled) chains.delete(path) })
  return next
}

export function createFileCredentialStore(path = oauthPath()): CredentialStore {
  return {
    async read(providerId) { return readAll(path)[providerId] },
    async list() { return Object.entries(readAll(path)).map(([providerId, c]): CredentialInfo => ({ providerId, type: c.type })) },
    modify(providerId, fn) {
      return serial(path, async () => {
        const next = await fn(readAll(path)[providerId])
        if (next !== undefined) writeAll(path, { ...readAll(path), [providerId]: next })
        return next ?? readAll(path)[providerId]
      })
    },
    delete(providerId) {
      return serial(path, async () => {
        const all = readAll(path)
        delete all[providerId]
        writeAll(path, all)
      })
    },
  }
}
