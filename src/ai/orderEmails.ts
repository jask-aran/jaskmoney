/**
 * What was bought, from the order emails behind a marketplace charge
 * (through Executor's Gmail, read-only). Measured on real mail (2026-10-30):
 *
 * - eBay: the bank text carries the order number (`eBay O*20-12345-67890`);
 *   a Gmail search for it finds the order's emails, and "Order confirmed:
 *   <item>" names the item. Headers only: eBay's emails are 50–90 KB of
 *   HTML, too slow to decode in Executor's sandbox.
 * - Amazon AU charges per shipment, not per order: each "Shipped" email's
 *   plain-text part lists the items (`* name`, `Quantity: n`, `9.32 AUD`)
 *   and a Total equal to the charge, sent hours to days before the bank
 *   sees it. One search covers every row's dates; the plain part is ~1 KB.
 *
 * One `execute` program does a batch (one round trip, about 3 s; the
 * searches and reads run in parallel inside Executor). The program only
 * fetches: bodies come back as Gmail sent them and are decoded here
 * (emailText: plain text, or HTML as markdown), since Executor's sandbox
 * decodes base64 a character at a time (seconds a message). Parsing and
 * matching to rows are here too.
 */
export interface Purchase { id: number; dateISO: string; createdMs: number | null; amount: number; description: string; rawText: string | null }

export interface Shipment { at: string; total: number | null; order: string | null; items: Array<{ name: string; quantity: number; price: number | null }> }
export interface EbayOrder { order: string; at: string | null; item: string | null }

export interface OrderContext { transactionId: number; source: "amazon" | "ebay"; order: string | null; items: string[]; emailAt: string | null; refundOf?: number }

/** The email a match used: no other row takes it (an eBay order's emails can serve each of its charges). */
export const emailKey = (c: Pick<OrderContext, "source" | "order" | "emailAt">) => (c.source === "ebay" ? `ebay:${c.order}` : `amazon:${c.order ?? ""}:${c.emailAt ?? ""}`)

/** What earlier lookups found: their rows and matches (for refunds), and the emails they used. */
export interface Prior { rows: Purchase[]; found: OrderContext[]; usedEmails: ReadonlySet<string> }

/** The eBay order number in a row's bank text, if any. */
export const ebayOrderOf = (rawText: string | null) => /eBay O\*(\d{2}-\d{5}-\d{5})/i.exec(rawText ?? "")?.[1] ?? null

export const isAmazon = (t: Pick<Purchase, "description" | "rawText">) => /^amazon(?! prime)/i.test(t.description.trim()) && !/AMZNPRIME/i.test(t.rawText ?? "")
export const isEbay = (t: Pick<Purchase, "description" | "rawText">) => /^ebay/i.test(t.description.trim()) || !!ebayOrderOf(t.rawText)

const gmailDate = (iso: string) => iso.replace(/-/g, "/")

/**
 * The program Executor runs for `rows`: Amazon's Shipped emails over the
 * rows' dates (from 7 days before the first to 2 after the last), and each
 * eBay order's emails by number. Returns { shipments, ebay }.
 */
export function orderEmailProgram(accountId: string, rows: Purchase[], gmail = "tools.gmail.api.users"): string {
  const amazon = rows.filter((t) => isAmazon(t) && t.amount < 0).map((t) => t.dateISO).sort()
  const orders = [...new Set(rows.filter(isEbay).map((t) => ebayOrderOf(t.rawText)).filter((o): o is string => !!o))]
  const window = amazon.length ? { after: gmailDate(addDaysIso(amazon[0]!, -7)), before: gmailDate(addDaysIso(amazon.at(-1)!, 2)) } : null
  return `const accountId = ${JSON.stringify(accountId)};
const g = ${gmail};
const list = async (q, max) => {
  const ids = []; let pageToken;
  do {
    const page = await g.gmailUsersMessagesList({ accountId, input: { path: { userId: "me" }, query: { q, maxResults: 100, ...(pageToken ? { pageToken } : {}) } } });
    ids.push(...(page.messages ?? []).map((m) => m.id)); pageToken = page.nextPageToken;
  } while (pageToken && ids.length < max);
  return ids;
};
const partsOf = (p) => [p, ...(p.parts ?? []).flatMap(partsOf)];
const shipments = [];
${window ? `for (const id of await list(${JSON.stringify(`from:shipment-tracking@amazon.com.au subject:Shipped after:${window.after} before:${window.before}`)}, 400)) {
  shipments.push(g.gmailUsersMessagesGet({ accountId, input: { path: { userId: "me", id }, query: { format: "full" } } }).then((m) => {
    // The body as Gmail sent it (base64url): decoding is the app's (emailText),
    // which takes microseconds where this sandbox takes seconds.
    const parts = partsOf(m.payload);
    const part = parts.find((p) => p.mimeType === "text/plain" && p.body?.data) ?? parts.find((p) => p.mimeType === "text/html" && p.body?.data);
    return { at: new Date(Number(m.internalDate)).toISOString(), mime: part?.mimeType ?? null, data: part?.body?.data ?? null };
  }));
}` : ""}
const ebay = ${JSON.stringify(orders)}.map(async (order) => {
  const ids = await list('"' + order + '"', 20);
  const heads = await Promise.all(ids.map((id) => g.gmailUsersMessagesGet({ accountId, input: { path: { userId: "me", id }, query: { format: "metadata", metadataHeaders: ["Subject"] } } })));
  return { order, emails: heads.map((m) => ({ at: new Date(Number(m.internalDate)).toISOString(), subject: m.payload?.headers?.find((h) => h.name === "Subject")?.value ?? "" })) };
});
return { shipments: await Promise.all(shipments), ebay: await Promise.all(ebay) };`
}

function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** An email body part (base64url) as text: plain as it is, HTML as markdown
 * (headings, list items, links' text, a line per block; no styles, scripts
 * or images). Enough for the parsers here and for a model to read. */
export function emailText(mime: string | null, data: string | null): string {
  if (!data) return ""
  const raw = Buffer.from(data, "base64url").toString("utf8")
  return mime === "text/html" ? htmlToMarkdown(raw) : raw.replace(/\r\n/g, "\n")
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'", "#160": " " }

export function htmlToMarkdown(html: string): string {
  return html
    .replace(/<(style|script|head|title)[\s\S]*?<\/\1>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<img[^>]*>/gi, "")
    .replace(/<h([1-6])[^>]*>/gi, (_, n: string) => `\n${"#".repeat(Number(n))} `)
    .replace(/<li[^>]*>/gi, "\n* ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|table|h[1-6]|li|ul|ol|section|td|th)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#?\w+);/g, (m, e: string) => ENTITIES[e] ?? (e.startsWith("#") ? String.fromCodePoint(Number(e.slice(1))) : m))
    .split("\n").map((l) => l.replace(/[\s\u00a0\u200b-\u200d\u034f\u2007]+/g, " ").trim()).filter(Boolean).join("\n")
}

const money = (s: string) => { const m = /^(\d+(?:\.\d+)?)\s*AUD$/.exec(s.trim()) ?? /^A?\$\s*(\d+(?:\.\d+)?)$/.exec(s.trim()); return m ? Math.round(Number(m[1]) * 100) / 100 : null }

/** A Shipped email's plain text: its order, items and total. */
export function readShipment(at: string, text: string): Shipment {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean)
  const shipment: Shipment = { at, total: null, order: null, items: [] }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (/^Order #$/i.test(line)) shipment.order = lines[i + 1] ?? null
    else if (line.startsWith("* ")) shipment.items.push({ name: line.slice(2).trim(), quantity: 1, price: null })
    else if (/^Quantity:\s*(\d+)/i.test(line) && shipment.items.length) {
      const item = shipment.items.at(-1)!
      item.quantity = Number(/(\d+)/.exec(line)![1])
      item.price = money(lines[i + 1] ?? "")
    } else if (/^Total$/i.test(line)) shipment.total = money(lines[i + 1] ?? "")
  }
  return shipment
}

/** eBay's order emails: the item, from "Order confirmed: <item>" (else any "<what>: <item>"). */
export function readEbay(order: string, emails: Array<{ at: string; subject: string }>): EbayOrder {
  const sorted = [...emails].sort((a, b) => a.at.localeCompare(b.at))
  const confirmed = sorted.find((e) => /^order confirmed:/i.test(e.subject))
  // Subjects cut the item short, each at its own length: the longest wins.
  const names = sorted.filter((e) => /order confirmed|order update|order delivered|delivered|shipped|on its way|carrier/i.test(e.subject) && e.subject.includes(":"))
    .map((e) => e.subject.replace(/^[^:]*:\s*/, "").replace(/[\p{Extended_Pictographic}\uFE0F]/gu, "").replace(/\s*(\.\.\.|…)\s*$/, "").trim())
  const item = names.sort((a, b) => b.length - a.length)[0] ?? null
  return { order, at: confirmed?.at ?? sorted[0]?.at ?? null, item: item || null }
}

const AMAZON_BEFORE_DAYS = 5
const REFUND_DAYS = 120
const AMAZON_AFTER_DAYS = 3

/**
 * Match rows to what the emails say. eBay: by order number. Amazon: a
 * Shipped email whose total is the charge to the cent, sent from 5 days
 * before the charge to 3 days after (Amazon sometimes charges a day before
 * it emails), closest first; each email to one row. A refund (money back
 * from Amazon) takes the items of the charge it returns: the same amount,
 * within REFUND_DAYS before it.
 */
export function matchOrders(rows: Purchase[], shipments: Shipment[], ebay: EbayOrder[], prior: Prior = { rows: [], found: [], usedEmails: new Set() }): OrderContext[] {
  const out: OrderContext[] = []
  const byOrder = new Map(ebay.map((e) => [e.order, e]))
  for (const t of rows.filter(isEbay)) {
    const order = ebayOrderOf(t.rawText)
    const found = order ? byOrder.get(order) : undefined
    if (found?.item) out.push({ transactionId: t.id, source: "ebay", order, items: [found.item], emailAt: found.at })
  }
  const used = new Set<Shipment>(shipments.filter((s) => prior.usedEmails.has(emailKey({ source: "amazon", order: s.order, emailAt: s.at }))))
  const when = (t: Purchase) => t.createdMs ?? Date.parse(`${t.dateISO}T12:00:00Z`)
  const amazon = rows.filter((t) => isAmazon(t) && t.amount < 0).sort((a, b) => when(a) - when(b))
  for (const t of amazon) {
    const charge = Math.round(-t.amount * 100)
    const candidates = shipments.filter((s) => !used.has(s) && s.total != null && Math.round(s.total * 100) === charge)
      .map((s) => ({ s, days: (when(t) - Date.parse(s.at)) / 86_400_000 }))
      .filter(({ days }) => days <= AMAZON_BEFORE_DAYS && days >= -AMAZON_AFTER_DAYS)
      .sort((a, b) => Math.abs(a.days) - Math.abs(b.days))
    const best = candidates[0]?.s
    if (!best) continue
    used.add(best)
    out.push({ transactionId: t.id, source: "amazon", order: best.order, items: best.items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.name}`), emailAt: best.at })
  }
  const charges = [...prior.found.filter((c) => c.source === "amazon" && !c.refundOf), ...out.filter((c) => c.source === "amazon")]
  const byId = new Map([...prior.rows, ...rows].map((t) => [t.id, t]))
  const refunded = new Set<number>(prior.found.flatMap((c) => (c.refundOf ? [c.refundOf] : [])))
  for (const t of rows.filter((r) => isAmazon(r) && r.amount > 0).sort((a, b) => when(a) - when(b))) {
    const charge = charges
      .map((c) => ({ c, row: byId.get(c.transactionId)! }))
      .filter(({ c, row }) => row && !refunded.has(c.transactionId) && Math.round(-row.amount * 100) === Math.round(t.amount * 100) && when(row) <= when(t) && (when(t) - when(row)) / 86_400_000 <= REFUND_DAYS)
      .sort((a, b) => when(b.row) - when(a.row))[0]
    if (!charge) continue
    refunded.add(charge.c.transactionId)
    out.push({ ...charge.c, transactionId: t.id, refundOf: charge.c.transactionId })
  }
  return out
}

/** Rows whose purchase emails could say what was bought. */
export const marketplaceRows = <T extends Pick<Purchase, "description" | "rawText">>(rows: T[]) => rows.filter((t) => isAmazon(t) || isEbay(t))


/**
 * When a row's lookup is due (purchase_lookups): never looked up; or found
 * nothing yet, RETRY_HOURS ago or more, and wasn't given up. A found or
 * given-up row is never looked up again (look again forgets it).
 */
export const LOOKUP_RETRY_HOURS = 6
/** Emails can come days after the charge (Amazon ships, then emails):
 * nothing found by this age, after one look at that age, is given up. */
export const LOOKUP_GIVE_UP_DAYS = 14

export interface LookupState { status: "found" | "waiting" | "none"; checks: number; checkedAt: string }

const ageDays = (t: Purchase, nowMs: number) => (nowMs - (t.createdMs ?? Date.parse(`${t.dateISO}T12:00:00Z`))) / 86_400_000

export function dueForLookup<T extends Purchase>(rows: T[], lookups: ReadonlyMap<number, LookupState>, nowMs: number): T[] {
  return marketplaceRows(rows).filter((t) => {
    if (t.amount === 0) return false
    const l = lookups.get(t.id)
    if (!l) return true
    if (l.status !== "waiting") return false
    return nowMs - Date.parse(l.checkedAt) >= LOOKUP_RETRY_HOURS * 3_600_000
  })
}

/** After a lookup: each due row found, still waiting, or given up (old enough, and looked at that age). */
export function settleLookups(due: Purchase[], found: OrderContext[], lookups: ReadonlyMap<number, LookupState>, nowMs: number) {
  const byId = new Map(found.map((c) => [c.transactionId, c]))
  const checkedAt = new Date(nowMs).toISOString()
  return due.map((t) => {
    const c = byId.get(t.id)
    const checks = (lookups.get(t.id)?.checks ?? 0) + 1
    if (c) return { transactionId: t.id, status: "found" as const, source: c.source, order: c.order, items: c.items, emailKey: emailKey(c), refundOf: c.refundOf ?? null, checks, checkedAt }
    return { transactionId: t.id, status: ageDays(t, nowMs) >= LOOKUP_GIVE_UP_DAYS ? ("none" as const) : ("waiting" as const), source: null, order: null, items: [], emailKey: null, refundOf: null, checks, checkedAt }
  })
}
