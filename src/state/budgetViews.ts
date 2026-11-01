import { budgetCategoryLines, budgetView } from "../domain/budgetLines"
import { lastCall } from "./lastCall"

/** The Budgets tab's cycle view and category lines, shared with its key
 * handlers: a j on the Categories card reads the lines the tab drew, not
 * a fresh pass over the whole history (~10-30 ms a key). */
export const sharedBudgetView = lastCall(budgetView)
export const sharedCategoryLines = lastCall(budgetCategoryLines)
