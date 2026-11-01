/**
 * pi-ai, loaded on first use rather than with the app: importing it costs
 * ~115 ms of every start, and most starts never ask a model anything.
 * Bun's require loads an ES module synchronously, so callers stay sync.
 * It requires a local module (piAiModule) because pi-ai's package exports
 * only an `import` entry, which require can't resolve; types come from
 * `import type` and cost nothing.
 */
type PiAi = typeof import("./piAiModule")
type PiModels = typeof import("./piModelsModule")

export const piAi = (): PiAi => require("./piAiModule") as PiAi

/** Just the model registry and the providers (piModelsModule): what asking
 * a model takes. Most of pi-ai's load is its schema validators (typebox),
 * ~130 ms from source, all at once as the first suggestions after a sync
 * start; this is ~20 ms. */
export const piModels = (): PiModels => require("./piModelsModule") as PiModels

export const piProviders = {
  openai: () => piModels().openaiProvider(),
  openrouter: () => piModels().openrouterProvider(),
  typesafe: () => piModels().typesafeProvider(),
}
