import { expect, test } from "bun:test"
import { ebayOrderOf, matchOrders, readEbay, readShipment, type Purchase } from "./orderEmails"

const shipped = (items: Array<[string, number, string]>, total: string) => [
  "Your package was shipped!", "Order #", "250-0000000-0000001", "Track package", "https://example.com/track",
  ...items.flatMap(([name, qty, price]) => [`* ${name}`, `Quantity: ${qty}`, price]), "Total", total, "Amazon.com.au",
].join("\n")

const row = (id: number, dateISO: string, amount: number, description = "Amazon", rawText: string | null = "AMAZON AU MARKETPLACE, SYDNEY", time = "12:00:00Z"): Purchase =>
  ({ id, dateISO, createdMs: Date.parse(`${dateISO}T${time}`), amount, description, rawText })

test("a Shipped email: its order, items with quantity and price, and total", () => {
  expect(readShipment("2026-10-25T23:15:00Z", shipped([["Milk Jug, Stainless", 1, "24 AUD"], ["Tamper", 2, "21 AUD"]], "44.99999999999999 AUD"))).toEqual({
    at: "2026-10-25T23:15:00Z", order: "250-0000000-0000001", total: 45,
    items: [{ name: "Milk Jug, Stainless", quantity: 1, price: 24 }, { name: "Tamper", quantity: 2, price: 21 }],
  })
})

test("eBay: the order number from the bank text; the item from the longest subject", () => {
  expect(ebayOrderOf("eBay O*20-12345-67890  Sydney")).toBe("20-12345-67890")
  expect(ebayOrderOf("AMAZON AU RETAIL")).toBeNull()
  expect(readEbay("20-12345-67890", [
    { at: "2026-10-29T08:08:00Z", subject: "Order confirmed: Coffee Bean Ke..." },
    { at: "2026-10-29T11:59:00Z", subject: "🚚 Order update: Coffee Bean Keeper Canister ..." },
    { at: "2026-10-30T01:00:00Z", subject: "Return 123: You have a message" },
  ])).toEqual({ order: "20-12345-67890", at: "2026-10-29T08:08:00Z", item: "Coffee Bean Keeper Canister" })
})

test("matching: Amazon charge to the shipment of the same total nearby, each email once; eBay by order; a refund takes its charge's items", () => {
  const a = readShipment("2026-10-25T23:15:00Z", shipped([["Backflush Insert", 1, "9.32 AUD"]], "9.32 AUD"))
  const b = readShipment("2026-10-25T23:09:00Z", shipped([["Residue Cleaner", 1, "18.9 AUD"]], "18.9 AUD"))
  const late = readShipment("2026-04-29T11:47:00Z", shipped([["Colouring Book", 1, "28.05 AUD"]], "30.86 AUD"))
  const far = readShipment("2026-09-01T00:00:00Z", shipped([["Elsewhere", 1, "9.32 AUD"]], "9.32 AUD"))
  const rows = [
    row(1, "2026-10-26", -9.32), row(2, "2026-10-26", -18.9), row(3, "2026-10-26", -9.32),
    row(4, "2026-04-28", -30.86, "Amazon", "AMAZON AU RETAIL", "10:37:00Z"),
    row(5, "2026-10-29", -48.49, "eBay", "eBay O*20-12345-67890  Sydney"),
    row(6, "2026-11-20", 18.9, "Amazon"),
  ]
  const found = matchOrders(rows, [a, b, late, far], [{ order: "20-12345-67890", at: "2026-10-29T08:08:00Z", item: "Coffee Bean Keeper" }])
  const by = new Map(found.map((f) => [f.transactionId, f]))
  expect(by.get(1)?.items.map((i) => i.name)).toEqual(["Backflush Insert"])
  expect(by.get(2)?.items.map((i) => i.name)).toEqual(["Residue Cleaner"])
  expect(by.has(3)).toBe(false)
  expect(by.get(4)?.items.map((i) => i.name)).toEqual(["Colouring Book"])
  expect(by.get(5)).toMatchObject({ source: "ebay", order: "20-12345-67890", items: [{ name: "Coffee Bean Keeper", quantity: 1, price: 48.49 }] })
  expect(by.get(6)).toMatchObject({ items: [{ name: "Residue Cleaner", quantity: 1, price: 18.9 }], refundOf: 2 })
})
