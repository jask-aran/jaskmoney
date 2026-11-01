import { expect, onTestFinished, spyOn, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { handleKey } from "../../app/keys"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { renderApp } from "../../testing/app"
import { transaction } from "../../testing/fixtures"
import { key } from "../../testing/keys"
import { ink } from "../../theme"

for (const result of ["pending", "failed"] as const) {
  test(`detail remains visible and usable with ${result} provider details`, async () => {
    const fetch = spyOn(data, "transactionDetail").mockImplementation(() => result === "pending"
      ? new Promise(() => {})
      : Promise.reject(new Error("provider unavailable")))
    onTestFinished(() => fetch.mockRestore())
    const t = await renderApp({ width: 140, height: 44 })
    data.setState({ transactions: [transaction({ id: 1, description: "Visible detail", notes: "Local note" })], ready: true })
    ui.switchTab("manager")
    ui.setState({ detail: { id: 1, boughtTop: 0, notes: null } })
    await t.renderOnce()
    const note = t.captureSpans().lines.flatMap((line) => line.spans).find((span) => span.text.includes("Local note"))
    expect(note).toBeDefined()
    expect(note!.fg.toInts()).toEqual(RGBA.fromHex(ink.figure).toInts())
    expect(note!.bg).toBeDefined()
    expect(note!.attributes).toBe(0)
    expect(ui.activeScope()).toBe("manager.detail")
    handleKey(ui, key("escape"), data)
    await t.renderOnce()
    expect(ui.state.detail).toBeNull()
    expect(t.captureSpans().lines.flatMap((line) => line.spans).some((span) => span.text.includes("Local note"))).toBe(false)
  })
}
