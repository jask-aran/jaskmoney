import { executorSignedIn, gmailAccounts, runExecutor, type GmailAccount } from "../ai/executor"
import { dueForLookup, emailText, matchOrders, orderEmailProgram, readEbay, readShipment, settleLookups, type OrderContext, type Purchase } from "../ai/orderEmails"
import type { PurchaseLookup } from "../db/client"
import type { DataStore } from "../state/dataStore"

type Raw = { shipments: Array<{ at: string; mime: string | null; data: string | null }>; ebay: Array<{ order: string; emails: Array<{ at: string; subject: string }> }> }

export const purchaseSources = {
  signedIn: () => executorSignedIn(),
  accounts: () => gmailAccounts(),
  run: (code: string) => runExecutor(code) as Promise<Raw>,
  now: () => Date.now(),
}

let account: GmailAccount | null = null
let running: Promise<PurchaseRound> | null = null

export interface PurchaseRound { looked: number; found: number; resuggested: number; error: string | null }

export function lookUpPurchases(data: DataStore): Promise<PurchaseRound> {
  running ??= round(data).finally(() => { running = null })
  return running
}

const purchase = (t: { id: number; dateISO: string; createdMs: number | null; amount: number; description: string; rawText: string | null }): Purchase =>
  ({ id: t.id, dateISO: t.dateISO, createdMs: t.createdMs, amount: t.amount, description: t.description, rawText: t.rawText })

async function round(data: DataStore): Promise<PurchaseRound> {
  const none: PurchaseRound = { looked: 0, found: 0, resuggested: 0, error: null }
  if (!purchaseSources.signedIn()) { account = null; return none }
  if (data.state.demo) return none
  const session = data.state.session
  const now = purchaseSources.now()
  const lookups = data.purchaseLookups()
  const rows = data.state.transactions.map(purchase)
  const due = dueForLookup(rows, lookups, now)
  try {
    if (!due.length) return { ...none, resuggested: await data.recordPurchases([], undefined, session) }
    const byId = new Map(rows.map((t) => [t.id, t]))
    const dueIds = new Set(due.map((t) => t.id))
    const earlier = [...lookups.values()].filter((l) => l.status === "found" && !dueIds.has(l.transactionId))
    const prior = {
      rows: earlier.flatMap((l) => byId.get(l.transactionId) ?? []),
      found: earlier.map((l): OrderContext => ({ transactionId: l.transactionId, source: l.source === "ebay" ? "ebay" : "amazon", order: l.order, items: l.items, emailAt: null, ...(l.refundOf ? { refundOf: l.refundOf } : {}) })),
      usedEmails: new Set(earlier.flatMap((l) => (l.emailKey ? [l.emailKey] : []))),
    }
    const needsMail = due.some((t) => t.amount < 0 || /ebay/i.test(t.description))
    let shipments: ReturnType<typeof readShipment>[] = []
    let ebay: ReturnType<typeof readEbay>[] = []
    if (needsMail) {
      account ??= (await purchaseSources.accounts())[0] ?? null
      if (!account) return { ...none, error: "no Gmail account in Executor" }
      const raw = await purchaseSources.run(orderEmailProgram(account.accountId, due, account.tools))
      shipments = raw.shipments.map((s) => readShipment(s.at, emailText(s.mime, s.data)))
      ebay = raw.ebay.map((e) => readEbay(e.order, e.emails))
    }
    const matched = matchOrders(due, shipments, ebay, prior)
    const settled: PurchaseLookup[] = settleLookups(due, matched, lookups, now).map((l) => {
      const before = lookups.get(l.transactionId)
      return l.status !== "found" && before?.status === "found" ? { ...before, legacy: false, checks: l.checks, checkedAt: l.checkedAt } : l
    })
    const resuggested = await data.recordPurchases(settled, undefined, session)
    return { looked: due.length, found: settled.filter((l) => l.status === "found" && lookups.get(l.transactionId)?.status !== "found").length, resuggested, error: null }
  } catch (error) {
    return { ...none, looked: due.length, error: error instanceof Error ? error.message : String(error) }
  }
}

export function purchasesNote(round: PurchaseRound): string {
  return round.found ? ` · ${round.found} purchase${round.found === 1 ? "" : "s"} found in email` : ""
}
