import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai"
import { defaultSettingsConfigPath } from "../state/settingsConfig"

/**
 * Browser sign-ins (OpenRouter, ChatGPT), kept by pi-ai's provider id in
 * oauth.json beside settings.json, owner-only (mode 600). pi-ai writes
 * through `modify` (login, token refresh); writes are serialized per
 * provider. Never rendered: the app only asks whether a provider is signed in.
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
  mkdirSync(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  writeFileSync(tmp, JSON.stringify(all, null, 2) + "\n", { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, path)
}

/** Whether a provider has a stored sign-in (sync: for rows and hints). */
export function signedIn(providerId: string, path = oauthPath()): boolean {
  return readAll(path)[providerId]?.type === "oauth"
}

export function createFileCredentialStore(path = oauthPath()): CredentialStore {
  const chains = new Map<string, Promise<unknown>>()
  const serial = <T>(id: string, task: () => Promise<T>): Promise<T> => {
    const next = (chains.get(id) ?? Promise.resolve()).then(task, task)
    chains.set(id, next.catch(() => undefined))
    return next
  }
  return {
    async read(providerId) { return readAll(path)[providerId] },
    async list() { return Object.entries(readAll(path)).map(([providerId, c]): CredentialInfo => ({ providerId, type: c.type })) },
    modify(providerId, fn) {
      return serial(providerId, async () => {
        const next = await fn(readAll(path)[providerId])
        if (next !== undefined) writeAll(path, { ...readAll(path), [providerId]: next })
        return next ?? readAll(path)[providerId]
      })
    },
    delete(providerId) {
      return serial(providerId, async () => {
        const all = readAll(path)
        delete all[providerId]
        writeAll(path, all)
      })
    },
  }
}
