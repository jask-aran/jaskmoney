import { budgetCategoryLines, budgetView } from "../domain/budgetLines"

/**
 * `fn` remembering its last call: called again with the same arguments
 * (each the same value, or the same object), it returns the last result.
 * For whole-history work that a tab and its key handler both need for one
 * key: the handler reads what the tab worked out. The arguments must be
 * replaced, never changed in place (the store's arrays are replaced whole).
 */
function lastCall<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  let last: { args: A; result: R } | null = null
  return (...args: A) => {
    if (last && last.args.length === args.length && last.args.every((a, i) => a === args[i])) return last.result
    const result = fn(...args)
    last = { args, result }
    return result
  }
}

/** The Budgets tab's cycle view and category lines, shared with its key
 * handlers: a j on the Categories card reads the lines the tab drew, not
 * a fresh pass over the whole history (~10-30 ms a key). */
export const sharedBudgetView = lastCall(budgetView)
export const sharedCategoryLines = lastCall(budgetCategoryLines)
