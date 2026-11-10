import { afterEach, expect, test } from "bun:test"
import { rmSync } from "node:fs"
import type { AuthInteraction } from "@earendil-works/pi-ai"
import { createFileCredentialStore, oauthPath } from "../ai/oauthStore"
import { data } from "../state/dataStore"

afterEach(() => { rmSync(oauthPath(), { force: true }) })

test("a browser sign-in runs in the core: its address and paste prompt come to the client as progress, the paste goes back, and sign-out forgets it there", async () => {
  data.init(":memory:")
  const progress: Array<{ url: string | null; message: string; paste: string | null }> = []
  let pasted = ""
  const login = async (provider: string, _type: string, interaction: AuthInteraction) => {
    interaction.notify({ type: "auth_url", url: "https://example.test/authorize" })
    pasted = await interaction.prompt({ type: "manual_code", message: "Paste the redirect URL:" })
    await createFileCredentialStore().modify(provider, async () => ({ type: "oauth", access: "access-for-test", refresh: "refresh-for-test", expires: Date.now() + 60_000 }))
    return { type: "oauth" as const, access: "", refresh: "", expires: 0 }
  }
  const running = data.signInLlm("openai", (p) => progress.push(p), undefined, { login } as never)
  await Bun.sleep(0)
  expect(progress.at(-1)).toMatchObject({ url: "https://example.test/authorize", paste: "Paste the redirect URL:" })
  expect(await data.signInPaste("openai", "http://127.0.0.1:1455/auth/callback?code=abc")).toBe(true)
  await running
  expect(pasted).toBe("http://127.0.0.1:1455/auth/callback?code=abc")
  expect(data.state.signedIn.openai).toBe(true)
  expect(JSON.stringify(data.state)).not.toContain("access-for-test")
  expect(await data.signInPaste("openai", "late")).toBe(false)
  await data.signOutLlm("openai")
  expect(data.state.signedIn.openai).toBe(false)
})
