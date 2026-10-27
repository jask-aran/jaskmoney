/** Test sessions use scratch paths, memory databases, and no real credentials. */
import { beforeEach } from "bun:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { data } from "./state/dataStore"
import { ui } from "./state/uiStore"
import { testEnv } from "./testing/scoped"
import { CREDENTIAL_NAMES } from "./ai/credentials"

const settingsDirectory = mkdtempSync(join(tmpdir(), "jaskmoney-test-"))
// Every app credential and setting beside them, Up's token, and the keys
// pi-ai would find by itself.
const credentialVariables = [...CREDENTIAL_NAMES, "JASKMONEY_UP_TOKEN", "OPENAI_API_KEY", "OPENROUTER_API_KEY"]
// Protect default paths and module-scope code before test files are evaluated.
process.env.HOME = settingsDirectory
process.env.XDG_CONFIG_HOME = join(settingsDirectory, "config")
process.env.XDG_DATA_HOME = join(settingsDirectory, "data")
process.env.JASKMONEY_CONFIG = join(settingsDirectory, "settings.json")
process.env.JASKMONEY_DB = ":memory:"
for (const name of credentialVariables) process.env[name] = ""

beforeEach(() => {
  // A separate directory also isolates files beside settings, such as credentials.json.
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
