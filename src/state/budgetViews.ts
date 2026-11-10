import { budgetCategoryLines, budgetView } from "../domain/budgetLines"

function lastCall<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let last: { args: A; result: R } | null = null
  return (...args: A) => {
    if (last && last.args.length === args.length && last.args.every((a, i) => a === args[i])) return last.result
    const result = fn(...args)
    last = { args, result }
    return result
  }
}

export const sharedBudgetView = lastCall(budgetView)
export const sharedCategoryLines = lastCall(budgetCategoryLines)
