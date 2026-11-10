import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth"

export * from "@earendil-works/pi-ai"
export { openaiProvider } from "@earendil-works/pi-ai/providers/openai"
export { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter"
export { typesafeProvider } from "@earendil-works/pi-ai/providers/typesafe"

registerBunOAuthFlows()
