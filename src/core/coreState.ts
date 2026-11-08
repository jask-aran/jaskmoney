import { CREDENTIAL_NAMES, credentialEnv, credentialSource, NOT_SECRET } from "../ai/credentials"
import { jevRoute } from "../ai/jev"
import { hasLlm, llmModelId } from "../ai/llm"
import { searchUsesClairic } from "../ai/workersAi"
import { hasUpToken } from "../up/client"
import { signedIn } from "../ai/oauthStore"
import { emptyCoreState, type CoreState } from "./protocol"

/** How long the range, account and chart views sit still before they're written. */
export const CONFIG_SETTLE_MS = 400

const loadSignedIn = (): CoreState["signedIn"] => ({ openrouter: signedIn("openrouter"), openai: signedIn("openai") })

/** Each API key's source and mask, read now. */
function loadApiKeys(): CoreState["apiKeys"] {
  const env = credentialEnv()
  return Object.fromEntries(CREDENTIAL_NAMES.map((name) => [name, { source: credentialSource(name), mask: NOT_SECRET.has(name) ? (env[name] ?? "") : "" }])) as CoreState["apiKeys"]
}

/** What the clients know of the credentials: which services are set up. */
export function keyState(): Pick<CoreState, "apiKeys" | "signedIn" | "jev" | "clairic" | "llm" | "upToken"> {
  const env = credentialEnv()
  return { apiKeys: loadApiKeys(), signedIn: loadSignedIn(), jev: jevRoute(env)?.provider ?? null, clairic: searchUsesClairic(env), llm: hasLlm(env) ? llmModelId(env) : null, upToken: hasUpToken(env) }
}

export function initialCoreState(): CoreState {
  return { ...emptyCoreState(), apiKeys: loadApiKeys(), signedIn: loadSignedIn() }
}
