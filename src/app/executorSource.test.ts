import { expect, onTestFinished, spyOn, test } from "bun:test"
import { ui } from "../state/uiStore"
import { openExecutorDialog, runExecutorAction, sources } from "./executorSource"

test("a failed Executor status check releases busy on opening and recheck", async () => {
  const failure = new Error("status unavailable")
  const status = spyOn(sources, "status").mockRejectedValue(failure)
  onTestFinished(() => status.mockRestore())

  await expect(openExecutorDialog(ui)).rejects.toThrow("status unavailable")
  expect(ui.state.executor?.busy).toBeNull()

  ui.setState("executor", { status: { signedIn: true, tools: [], error: "check again" } })
  await expect(runExecutorAction(ui)).rejects.toThrow("status unavailable")
  expect(ui.state.executor?.busy).toBeNull()
})

test("a late failed Executor status check leaves the next opening busy", async () => {
  let reject!: (error: Error) => void
  const pending = new Promise<never>((_, no) => { reject = no })
  const status = spyOn(sources, "status").mockReturnValue(pending)
  onTestFinished(() => status.mockRestore())

  const checking = openExecutorDialog(ui)
  const result = checking.catch((error: unknown) => error)
  ui.switchTab("overview")
  ui.setState({ executor: { status: null, cursor: 0, busy: "Checking Executor…", waiting: null, note: null } })
  reject(new Error("status unavailable"))
  expect(await result).toEqual(new Error("status unavailable"))
  expect(ui.state.executor?.busy).toBe("Checking Executor…")
})
