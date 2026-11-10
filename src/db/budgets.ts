import { budgetIn, type Budget, type BudgetHistoryEntry, type BudgetScope, type CycleConfig } from "../domain/budget"
import type { Db } from "./client"

export function loadBudgets(db: Db): Budget[] {
  const rows = db.query(`SELECT id, scope_kind AS kind, target_id AS targetId, amount FROM budgets ORDER BY sort_order, id`)
    .all() as Array<{ id: number; kind: "overall" | "account" | "category"; targetId: number | null; amount: number }>
  return rows.map((r) => ({
    id: r.id,
    amount: r.amount,
    scope: r.kind === "overall" ? { kind: "overall" } : r.kind === "account" ? { kind: "account", accountId: r.targetId! } : { kind: "category", categoryId: r.targetId! },
  }))
}

export function loadBudgetHistory(db: Db): BudgetHistoryEntry[] {
  const rows = db.query<{
    kind: BudgetScope["kind"]; targetId: number | null; amount: number | null; from: string | null
  }, []>(`SELECT scope_kind AS kind, target_id AS targetId, amount, from_date AS "from"
    FROM budget_history
    ORDER BY CASE scope_kind WHEN 'overall' THEN 0 WHEN 'account' THEN 1 ELSE 2 END, target_id, from_date`).all()
  return rows.map((r) => ({
    scope: r.kind === "overall" ? { kind: "overall" } : r.kind === "account" ? { kind: "account", accountId: r.targetId! } : { kind: "category", categoryId: r.targetId! },
    amount: r.amount,
    from: r.from,
  }))
}

export function recordBudget(db: Db, scope: BudgetScope, amount: number | null, from: string | null, nowStart: string): void {
  if (amount != null && (!Number.isFinite(amount) || amount < 0)) throw new Error("budget amount can't be negative")
  const target = scope.kind === "overall" ? null : scope.kind === "account" ? scope.accountId : scope.categoryId
  db.query(`INSERT INTO budget_history (scope_kind, target_id, amount, from_date) VALUES (?, ?, ?, ?)
    ON CONFLICT DO UPDATE SET amount = excluded.amount`).run(scope.kind, target, amount, from)
  const now = budgetIn(loadBudgetHistory(db), scope, nowStart)
  const existing = db.query(`SELECT id FROM budgets WHERE scope_kind = ? AND COALESCE(target_id, 0) = COALESCE(?, 0)`).get(scope.kind, target) as { id: number } | null
  if (now == null) { if (existing) db.query(`DELETE FROM budgets WHERE id = ?`).run(existing.id); return }
  if (existing) { db.query(`UPDATE budgets SET amount = ? WHERE id = ?`).run(now, existing.id); return }
  const order = (db.query(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM budgets`).get() as { n: number }).n
  db.query(`INSERT INTO budgets (scope_kind, target_id, amount, sort_order) VALUES (?, ?, ?, ?)`).run(scope.kind, target, now, order)
}

export function loadBudgetCycle(db: Db): CycleConfig {
  const row = db.query(`SELECT unit, anchor, anchor_date AS anchorDate, pay_early AS payEarly FROM budget_cycle WHERE id = 1`)
    .get() as (Omit<CycleConfig, "payEarly"> & { payEarly: number }) | null
  return row ? { ...row, payEarly: row.payEarly === 1 } : { unit: "month", anchor: "calendar", anchorDate: null, payEarly: false }
}

export function saveBudgetCycle(db: Db, config: CycleConfig): void {
  if (config.anchor !== "calendar" && !/^\d{4}-\d{2}-\d{2}$/.test(config.anchorDate ?? "")) throw new Error("enter the cycle date as YYYY-MM-DD")
  db.query(`INSERT INTO budget_cycle (id, unit, anchor, anchor_date, pay_early) VALUES (1, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET unit = excluded.unit, anchor = excluded.anchor, anchor_date = excluded.anchor_date, pay_early = excluded.pay_early`)
    .run(config.unit, config.anchor, config.anchor === "calendar" ? null : config.anchorDate, config.payEarly ? 1 : 0)
}
