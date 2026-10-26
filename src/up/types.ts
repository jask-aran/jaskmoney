/**
 * Up Bank API v1 response shapes used by the sync, from the published
 * OpenAPI spec (github.com/up-banking/api, v1/openapi.json). Only fields the
 * sync reads are declared; the API returns more.
 */

export interface UpMoney {
  currencyCode: string
  /** Decimal string without symbol, e.g. "-10.56". */
  value: string
  /** Smallest denomination as an integer, e.g. -1056. */
  valueInBaseUnits: number
}

export type UpAccountType = "SAVER" | "TRANSACTIONAL" | "HOME_LOAN"

export interface UpAccount {
  type: "accounts"
  id: string
  attributes: {
    displayName: string
    accountType: UpAccountType
    ownershipType: "INDIVIDUAL" | "JOINT"
    balance: UpMoney
    /** RFC 3339 with offset. */
    createdAt: string
  }
}

interface UpRelationship<T extends string> {
  data: { type: T; id: string } | null
}

export type UpTransactionStatus = "HELD" | "SETTLED"

export interface UpTransaction {
  type: "transactions"
  /** Stable across HELD → SETTLED. */
  id: string
  attributes: {
    status: UpTransactionStatus
    rawText: string | null
    /** Usually the merchant name. */
    description: string
    message: string | null
    amount: UpMoney
    foreignAmount: UpMoney | null
    /** RFC 3339 with the account's local offset, e.g. 2026-02-03T09:14:00+11:00. */
    createdAt: string
    settledAt: string | null
    transactionType: string | null
    /** False for transactions Up will not categorise (e.g. transfers). */
    isCategorizable: boolean
    roundUp: { amount: UpMoney; boostPortion: UpMoney | null } | null
    cashback: { description: string; amount: UpMoney } | null
    cardPurchaseMethod: { method: string; cardNumberSuffix: string | null } | null
  }
  relationships: {
    account: { data: { type: "accounts"; id: string } }
    /** Set when money moved between the customer's own accounts. */
    transferAccount: UpRelationship<"accounts">
    category: UpRelationship<"categories">
    parentCategory: UpRelationship<"categories">
    tags: { data: Array<{ type: "tags"; id: string }> }
  }
}

/** Every list endpoint pages newest-first through `links.next`. */
export interface UpPage<T> {
  data: T[]
  links: { prev: string | null; next: string | null }
}

/** Error body for non-2xx responses. */
export interface UpErrorBody {
  errors: Array<{ status: string; title: string; detail: string }>
}
