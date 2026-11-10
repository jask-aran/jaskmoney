type PiAi = typeof import("./piAiModule")
type PiModels = typeof import("./piModelsModule")

export const piAi = (): PiAi => require("./piAiModule") as PiAi

export const piModels = (): PiModels => require("./piModelsModule") as PiModels

export const piProviders = {
  openai: () => piModels().openaiProvider(),
  openrouter: () => piModels().openrouterProvider(),
  typesafe: () => piModels().typesafeProvider(),
}
