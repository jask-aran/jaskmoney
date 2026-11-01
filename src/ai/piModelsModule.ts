/** pi-ai's model registry and the providers the app uses, without the rest
 * of pi-ai, for piModels' lazy require. */
import { registerBunOAuthFlows } from "@earendil-works/pi-ai/bun-oauth"

export { createModels } from "@earendil-works/pi-ai/models"
export { openaiProvider } from "@earendil-works/pi-ai/providers/openai"
export { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter"
export { typesafeProvider } from "@earendil-works/pi-ai/providers/typesafe"

// As piAiModule: the binary's sign-in flows (a refresh of OpenRouter's
// sign-in may need them before anything loads piAiModule).
registerBunOAuthFlows()
