/** pi-ai and the providers the app uses, as one module for piAi's lazy require. */
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth"

export * from "@earendil-works/pi-ai"
export { openaiProvider } from "@earendil-works/pi-ai/providers/openai"
export { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter"
export { typesafeProvider } from "@earendil-works/pi-ai/providers/typesafe"

// pi-ai loads its sign-in flows through an import path held in a variable,
// so a bundler can't follow it: in the standalone binary (dist/jaskmoney)
// "Sign in with ChatGPT" and OpenRouter's sign-in failed with "Cannot find
// module './openrouter.js'". This embeds them, as pi-ai says to for Bun
// binaries; from source it changes nothing.
registerBunOAuthFlows()
