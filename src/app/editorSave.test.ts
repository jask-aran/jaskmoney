import { expect, test } from "bun:test"
import { data } from "../state/dataStore"

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
