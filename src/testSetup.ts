import { beforeEach } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { data } from "./state/dataStore"
import { ui } from "./state/uiStore"
import { testEnv } from "./testing/scoped"
import { CREDENTIAL_NAMES } from "./ai/credentials"
import { sources } from "./app/executorSource"
import { purchaseSources } from "./app/purchases"
import { sources as welcomeSources } from "./app/welcome"
import { cloudflare } from "./ai/workersAi"
import { watchRowLifetimes } from "./state/rowLifetimes"

const stopRowLifetimes = watchRowLifetimes(ui, data)
process.once("exit", stopRowLifetimes)

const settingsDirectory = mkdtempSync(join(tmpdir(), "jaskmoney-test-"))
const credentialVariables = [...CREDENTIAL_NAMES, "JASKMONEY_UP_TOKEN", "OPENAI_API_KEY", "OPENROUTER_API_KEY"]
process.env.HOME = settingsDirectory
process.env.XDG_CONFIG_HOME = join(settingsDirectory, "config")
process.env.XDG_DATA_HOME = join(settingsDirectory, "data")
process.env.JASKMONEY_CONFIG = join(settingsDirectory, "settings.json")
process.env.JASKMONEY_DB = ":memory:"
for (const name of credentialVariables) process.env[name] = ""

Object.assign(sources, {
  open: () => {},
  status: async () => ({ signedIn: false, tools: [], error: null }),
  signIn: async () => { throw new Error("no Executor in tests") },
  run: async () => { throw new Error("no Executor in tests") },
  signOut: () => {},
})
cloudflare.accounts = async () => [{ id: "acct-test", name: "Test account" }]
Object.assign(welcomeSources, {
  open: () => {},
  upAccounts: async () => { throw new Error("no Up in tests") },
  executorSignedIn: () => false,
  signInExecutor: async () => { throw new Error("no Executor in tests") },
  ensureMailApp: async () => { throw new Error("no Executor in tests") },
  mailAccount: async () => { throw new Error("no Executor in tests") },
  connectLink: async () => { throw new Error("no Executor in tests") },
  waitForAccount: async () => { throw new Error("no Executor in tests") },
  countOrders: async () => { throw new Error("no Executor in tests") },
  tickers: async () => null,
})
purchaseSources.signedIn = () => false
purchaseSources.accounts = async () => { throw new Error("no Executor in tests") }
purchaseSources.run = async () => { throw new Error("no Executor in tests") }

beforeEach(() => {
  const directory = mkdtempSync(join(settingsDirectory, "test-"))
  testEnv("HOME", directory)
  testEnv("XDG_CONFIG_HOME", join(directory, "config"))
  testEnv("XDG_DATA_HOME", join(directory, "data"))
  testEnv("JASKMONEY_CONFIG", join(directory, "settings.json"))
  testEnv("JASKMONEY_DB", ":memory:")
  for (const name of credentialVariables) testEnv(name, "")
  data.reset()
  ui.reset()
})
