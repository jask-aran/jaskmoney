import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, rmSync, statSync, writeFileSync } from "node:fs"
import { credentialEnv, credentialSource, credentialsPath, loadSavedCredentials, maskSecret, saveCredentials } from "./credentials"

describe("saved API keys", () => {
  afterEach(() => rmSync(credentialsPath(), { force: true }))

  test("live beside the (test) settings file, owner-only, and never in the real config", () => {
    expect(credentialsPath()).not.toContain(".config/jaskmoney-opentui")
    saveCredentials({ JASKMONEY_JEV_TOKEN: " apikey_abc123 " })
    expect(statSync(credentialsPath()).mode & 0o777).toBe(0o600)
    expect(loadSavedCredentials()).toEqual({ JASKMONEY_JEV_TOKEN: "apikey_abc123" })
  })

  test("a saved key wins over the environment; removing it falls back to the environment", () => {
    const env = { JASKMONEY_JEV_TOKEN: "from-env", OTHER: "x" }
    expect(credentialSource("JASKMONEY_JEV_TOKEN", env)).toBe("env")
    saveCredentials({ JASKMONEY_JEV_TOKEN: "saved-key", JASKMONEY_CF_ACCOUNT_ID: "acct" })
    expect(credentialEnv(env)).toMatchObject({ JASKMONEY_JEV_TOKEN: "saved-key", JASKMONEY_CF_ACCOUNT_ID: "acct", OTHER: "x" })
    expect(credentialSource("JASKMONEY_JEV_TOKEN", env)).toBe("saved")
    saveCredentials({ JASKMONEY_JEV_TOKEN: null })
    expect(loadSavedCredentials()).toEqual({ JASKMONEY_CF_ACCOUNT_ID: "acct" })
    expect(credentialEnv(env).JASKMONEY_JEV_TOKEN).toBe("from-env")
    expect(credentialSource("JASKMONEY_JEV_TOKEN", {})).toBeNull()
  })

  test("a broken or foreign file reads as nothing saved", () => {
    writeFileSync(credentialsPath(), "{not json")
    expect(loadSavedCredentials()).toEqual({})
    writeFileSync(credentialsPath(), JSON.stringify({ JASKMONEY_JEV_TOKEN: 5, SOMETHING_ELSE: "x" }))
    expect(loadSavedCredentials()).toEqual({})
    expect(existsSync(credentialsPath())).toBe(true)
  })

  test("a mask shows only the last four", () => {
    expect(maskSecret("apikey_secret_3728")).toBe("•••• 3728")
    expect(maskSecret("")).toBe("")
    expect(maskSecret(undefined)).toBe("")
  })
})
