interface UpMoney {
  currencyCode: string
  value: string
  valueInBaseUnits: number
}

type UpAccountType = "SAVER" | "TRANSACTIONAL" | "HOME_LOAN"

export interface UpAccount {
  type: "accounts"
  id: string
  attributes: {
    displayName: string
    accountType: UpAccountType
    ownershipType: "INDIVIDUAL" | "JOINT"
    balance: UpMoney
    createdAt: string
  }
}

interface UpRelationship<T extends string> {
  data: { type: T; id: string } | null
}

type UpTransactionStatus = "HELD" | "SETTLED"

export interface UpTransaction {
  type: "transactions"
  id: string
  attributes: {
    status: UpTransactionStatus
    rawText: string | null
    description: string
    message: string | null
    amount: UpMoney
    foreignAmount: UpMoney | null
    createdAt: string
    settledAt: string | null
    transactionType: string | null
    isCategorizable: boolean
    roundUp: { amount: UpMoney; boostPortion: UpMoney | null } | null
    cashback: { description: string; amount: UpMoney } | null
    cardPurchaseMethod: { method: string; cardNumberSuffix: string | null } | null
  }
  relationships: {
    account: { data: { type: "accounts"; id: string } }
    transferAccount: UpRelationship<"accounts">
    category: UpRelationship<"categories">
    parentCategory: UpRelationship<"categories">
    tags: { data: Array<{ type: "tags"; id: string }> }
  }
}

export interface UpPage<T> {
  data: T[]
  links: { prev: string | null; next: string | null }
}
