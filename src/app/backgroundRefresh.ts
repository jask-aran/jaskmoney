import type { DataStore } from "../state/dataStore"
import { lookUpPurchases, type PurchaseRound } from "./purchases"
import { suggestNew } from "./suggest"

/** Learn purchases before suggesting. Lookup failures stay quiet in the
 * purchase round; an unexpected failure is returned for the sync status. */
export async function runBackgroundRefresh(data: DataStore): Promise<{ purchases: PurchaseRound; suggested: number; error: string | null }> {
  let purchases: PurchaseRound = { looked: 0, found: 0, resuggested: 0, error: null }
  try {
    purchases = await lookUpPurchases(data)
    const suggested = await suggestNew(data)
    return { purchases, suggested, error: null }
  } catch (error) {
    return { purchases, suggested: 0, error: error instanceof Error ? error.message : String(error) }
  }
}
