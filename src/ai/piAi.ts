/**
 * pi-ai, loaded on first use rather than with the app: importing it costs
 * ~115 ms of every start, and most starts never ask a model anything.
 * Bun's require loads an ES module synchronously, so callers stay sync.
 * It requires a local module (piAiModule) because pi-ai's package exports
 * only an `import` entry, which require can't resolve; types come from
 * `import type` and cost nothing.
 */
type PiAi = typeof import("./piAiModule")

export const piAi = (): PiAi => require("./piAiModule") as PiAi

export const piProviders = {
  openai: () => piAi().openaiProvider(),
  openrouter: () => piAi().openrouterProvider(),
  typesafe: () => piAi().typesafeProvider(),
}
