import { expect, spyOn, test } from "bun:test"
import { data } from "../state/dataStore"
import { ui } from "../state/uiStore"
import { key } from "../testing/keys"
import { handleKey } from "./keys"

test("a second enter while the settings editor's save is on its way doesn't save again", async () => {
  data.init(":memory:")
  ui.switchTab("settings")
  let finish!: () => void
  const create = spyOn(data, "createSettingsCategory").mockImplementation(() => new Promise<number>((resolve) => { finish = () => resolve(1) }))
  try {
    ui.openSettingsEditor("category", null, { ...ui.state.settingsDraft, name: "Coffee", color: "#123456" })
    handleKey(ui, key("return"), data)
    handleKey(ui, key("return"), data)
    expect(create).toHaveBeenCalledTimes(1)
    finish()
    await Bun.sleep(0)
    expect(ui.state.settingsEditor).toBeNull()
    expect(ui.state.status).toBe("Saved")
  } finally {
    create.mockRestore()
    ui.setState({ settingsEditor: null })
  }
})

test("changing what a budget covers is one write: if the new budget can't be saved, the old one stays", async () => {
  data.init(":memory:")
  const db = data.getDb()!
  const category = data.state.categories.find((c) => !c.isDefault)!.id
  await data.setBudget({ kind: "overall" }, 2000)
  db.exec(`CREATE TRIGGER refuse BEFORE INSERT ON budget_history WHEN NEW.scope_kind = 'category' BEGIN SELECT RAISE(ABORT, 'refused'); END`)
  await expect(data.setBudget({ kind: "category", categoryId: category }, 300, undefined, { kind: "overall" })).rejects.toThrow("refused")
  expect(db.query("SELECT scope_kind, amount FROM budget_history").all()).toEqual([{ scope_kind: "overall", amount: 2000 }])
  db.exec("DROP TRIGGER refuse")
  await data.setBudget({ kind: "category", categoryId: category }, 300, undefined, { kind: "overall" })
  expect(data.state.budgets.map((b) => b.scope.kind)).toEqual(["category"])
})
