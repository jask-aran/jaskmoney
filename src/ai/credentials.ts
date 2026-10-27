import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { writeJsonAtomic } from "../storage/json"
import { defaultSettingsConfigPath } from "../state/settingsConfig"

/**
 * API keys (and the Up token), kept in credentials.json beside settings.json
 * in ~/.jaskmoney (owner-only, mode 600). A saved key takes priority over the environment
 * variable of the same name (Bun loads `.env`), so what the user typed is
 * what is used. Values are never rendered: `maskSecret` shows the last four.
 */

// The general model's settings sit beside its keys: the models and the
// provider in use aren't secrets (NOT_SECRET); JASKMONEY_LLM_MODEL is the
// OpenRouter model's former name, still read.
export const CREDENTIAL_NAMES = [
  "JASKMONEY_UP_TOKEN",
  "JASKMONEY_JEV_TOKEN", "JASKMONEY_CF_TOKEN", "JASKMONEY_CF_ACCOUNT_ID",
  "JASKMONEY_OPENROUTER_TOKEN", "JASKMONEY_OPENROUTER_MODEL", "JASKMONEY_LLM_MODEL",
  "JASKMONEY_OPENAI_TOKEN", "JASKMONEY_OPENAI_MODEL", "JASKMONEY_LLM_PROVIDER",
] as const
export const NOT_SECRET: ReadonlySet<CredentialName> = new Set(["JASKMONEY_OPENROUTER_MODEL", "JASKMONEY_LLM_MODEL", "JASKMONEY_OPENAI_MODEL", "JASKMONEY_LLM_PROVIDER"])
export type CredentialName = (typeof CREDENTIAL_NAMES)[number]
type Saved = Partial<Record<CredentialName, string>>

export function credentialsPath(): string {
  return join(dirname(defaultSettingsConfigPath()), "credentials.json")
}

export function loadSavedCredentials(path = credentialsPath()): Saved {
  if (!existsSync(path)) return {}
  try {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"))
    if (typeof raw !== "object" || raw === null) return {}
    const saved: Saved = {}
    for (const name of CREDENTIAL_NAMES) {
      const value = (raw as Record<string, unknown>)[name]
      if (typeof value === "string" && value.trim()) saved[name] = value.trim()
    }
    return saved
  } catch {
    return {}
  }
}

/** Save or (with null) remove keys; the file is written owner-only, then
 * moved into place. */
export function saveCredentials(patch: Partial<Record<CredentialName, string | null>>, path = credentialsPath()): void {
  const next: Saved = { ...loadSavedCredentials(path) }
  for (const name of CREDENTIAL_NAMES) {
    if (!(name in patch)) continue
    const value = patch[name]?.trim()
    if (value) next[name] = value
    else delete next[name]
  }
  writeJsonAtomic(path, next)
}

/** The environment with saved keys laid over it: what the AI clients read. */
export function credentialEnv(env: Record<string, string | undefined> = process.env): Record<string, string | undefined> {
  return { ...env, ...loadSavedCredentials() }
}

/** Where a key comes from, if anywhere. */
export function credentialSource(name: CredentialName, env: Record<string, string | undefined> = process.env): "saved" | "env" | null {
  if (loadSavedCredentials()[name]) return "saved"
  return env[name]?.trim() ? "env" : null
}

/** "•••• 3728": enough to tell keys apart, never the key. */
export function maskSecret(value: string | undefined): string {
  const v = value?.trim() ?? ""
  return v ? `•••• ${v.slice(-4)}` : ""
}
