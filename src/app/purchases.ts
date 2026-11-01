import { executorSignedIn, gmailAccounts, runExecutor, type GmailAccount } from "../ai/executor"
import { dueForLookup, emailText, matchOrders, orderEmailProgram, readEbay, readShipment, settleLookups, type OrderContext, type Purchase } from "../ai/orderEmails"
import type { PurchaseLookup } from "../db/client"
import type { DataStore } from "../state/dataStore"

/**
 * What Amazon and eBay rows bought, looked up in your order emails through
 * Executor after each sync (ai/orderEmails for how; purchase_lookups keeps
 * what each row's lookups found). Each row is looked up once if found;
 * if nothing is found yet, again after a while, since the email can come
 * after the charge, until it's two weeks old (dueForLookup). The due rows
 * go in one Executor program. Quiet: a failure leaves rows waiting for the
 * next sync. `sources` is replaced in tests.
 */
type Raw = { shipments: Array<{ at: string; mime: string | null; data: string | null }>; ebay: Array<{ order: string; emails: Array<{ at: string; subject: string }> }> }

export const purchaseSources = {
  signedIn: () => executorSignedIn(),
  accounts: () => gmailAccounts(),
  run: (code: string) => runExecutor(code) as Promise<Raw>,
  now: () => Date.now(),
}

/** The Gmail account lookups go through, found once per sign-in. */
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
  // Signed out: the next sign-in may reach another Gmail account.
  if (!purchaseSources.signedIn()) { account = null; return none }
  // Demo rows are made up; their emails don't exist.
  if (data.state.demo) return none
  // The rows looked up are this database's: what's found is saved to it only.
  const session = data.state.session
  const now = purchaseSources.now()
  const lookups = data.purchaseLookups()
  const rows = data.state.transactions.map(purchase)
  const due = dueForLookup(rows, lookups, now)
  try {
    // Nothing to look up: still ask again for rows suggested before their purchase was known.
    if (!due.length) return { ...none, resuggested: await data.recordPurchases([], undefined, session) }
    const byId = new Map(rows.map((t) => [t.id, t]))
    // Earlier rounds' finds, except the rows looked up now (one found before
    // prices were kept is looked up again, and its own email is fair game).
    const dueIds = new Set(due.map((t) => t.id))
    const earlier = [...lookups.values()].filter((l) => l.status === "found" && !dueIds.has(l.transactionId))
    const prior = {
      rows: earlier.flatMap((l) => byId.get(l.transactionId) ?? []),
      found: earlier.map((l): OrderContext => ({ transactionId: l.transactionId, source: l.source === "ebay" ? "ebay" : "amazon", order: l.order, items: l.items, emailAt: null, ...(l.refundOf ? { refundOf: l.refundOf } : {}) })),
      usedEmails: new Set(earlier.flatMap((l) => (l.emailKey ? [l.emailKey] : []))),
    }
    // Refunds take their charge's items without an email: no program if that's all.
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
    // A row found before that isn't found again keeps what it had (now saved with prices' shape).
    const settled: PurchaseLookup[] = settleLookups(due, matched, lookups, now).map((l) => {
      const before = lookups.get(l.transactionId)
      return l.status !== "found" && before?.status === "found" ? { ...before, legacy: false, checks: l.checks, checkedAt: l.checkedAt } : l
    })
    const resuggested = await data.recordPurchases(settled, undefined, session)
    // Newly found: a redone lookup (for prices) isn't news.
    return { looked: due.length, found: settled.filter((l) => l.status === "found" && lookups.get(l.transactionId)?.status !== "found").length, resuggested, error: null }
  } catch (error) {
    return { ...none, looked: due.length, error: error instanceof Error ? error.message : String(error) }
  }
}

/** " · 3 purchases found in email", or "" for none. */
export function purchasesNote(round: PurchaseRound): string {
  return round.found ? ` · ${round.found} purchase${round.found === 1 ? "" : "s"} found in email` : ""
}
