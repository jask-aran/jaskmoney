/**
 * What jaskmoney does with each integration, in plain words, for the
 * first-run setup (and Settings): every call it makes to Up and what each
 * changes; for each model, what it's sent and what it decides; for email,
 * what's read. Facts from the code, kept beside it: up/client (the Up
 * calls), core/upPush and core applyRules (when Up is written to),
 * ai/catalog (what each query sends), ai/orderEmails (what's read).
 */
export interface IntegrationUse {
  title: string
  /** One line: what it's for. */
  why: string
  /** What it does, each with its effect. `writes` marks a change made. */
  uses: { what: string; effect: string; writes?: boolean }[]
  /** The reassurances: what never happens, who decides. */
  promises: string[]
}

export const UP_USES: IntegrationUse = {
  title: "What jaskmoney does with Up",
  why: "Your accounts and transactions, kept in step with your categories and tags.",
  uses: [
    { what: "GET /util/ping", effect: "checks the token works" },
    { what: "GET /accounts", effect: "your accounts' names, types and balances" },
    { what: "GET /accounts/{id}/transactions", effect: "your transactions, new ones on each sync" },
    { what: "GET /categories", effect: "Up's category list" },
    { what: "PATCH /transactions/{id}/relationships/category", effect: "sets a category you chose", writes: true },
    { what: "POST · DELETE …/relationships/tags", effect: "adds or removes a tag you chose", writes: true },
  ],
  promises: [
    "Up's API can't move money: no payments, no transfers, nothing changes in your accounts.",
    "It writes only what you decide: a category or tag you set or accept, or one a rule you made sets. Undo puts Up back.",
    "The token stays on this computer (~/.jaskmoney/credentials.json, readable only by you).",
  ],
}

export const AI_USES_TEXT: Record<"jev" | "openrouter" | "openai" | "clairic", IntegrationUse> = {
  jev: {
    title: "TypeSafe: Jev",
    why: "Suggests categories and reads your searches. Optional.",
    uses: [
      { what: "Sees", effect: "a waiting transaction: its description, amount, in or out, Up's message, what its order emails say it bought, your note and tags" },
      { what: "Sees", effect: "your categories, a few merchants from each, and how you categorised the same merchant before" },
      { what: "Decides", effect: "a category and how sure it is; whether a shop sells many kinds of things; which rows a tag or search means" },
    ],
    promises: ["Suggestions wait for you: nothing is categorised until you accept.", "Never your card numbers, balances or token."],
  },
  openrouter: {
    title: "OpenRouter",
    why: "One sign-in for nearly all of it: it runs Jev (suggestions, smart search, ask:) and a general model that writes rules. Everything here but Clairic. Optional.",
    uses: [
      { what: "As Jev", effect: "without a TypeSafe key, Jev runs here: it sees a waiting transaction (description, amount, Up's message, what it bought, your note) and your categories, and suggests one" },
      { what: "For rules", effect: "your categories and tags with counts, recent choices, waiting rows' descriptions and your rules" },
      { what: "Decides", effect: "rules to offer you, as searches that set a category or tag" },
    ],
    promises: ["A rule is only made when you choose it.", "Signing in makes an API key on your OpenRouter account; delete it there any time."],
  },
  openai: {
    title: "ChatGPT (OpenAI)",
    why: "Writes rules on your ChatGPT plan, instead of OpenRouter. Optional.",
    uses: [
      { what: "Sees", effect: "your categories and tags with counts, recent choices, waiting rows' descriptions and your rules" },
      { what: "Decides", effect: "rules to offer you" },
    ],
    promises: ["A rule is only made when you choose it.", "Disconnect jaskmoney in ChatGPT's settings any time."],
  },
  clairic: {
    title: "Cloudflare: Clairic",
    why: "Reads the words and dates in a smart search (\"coffee last March\"). Optional.",
    uses: [
      { what: "Sees", effect: "the words of your search and today's date" },
      { what: "Decides", effect: "which words matter and which dates you mean" },
    ],
    promises: ["Never your transactions."],
  },
}

export const EMAIL_USES: IntegrationUse = {
  title: "What jaskmoney does with your email",
  why: "An Amazon or eBay row says only \"Amazon\": the order email says what you bought.",
  uses: [
    { what: "Searches", effect: "Gmail for order emails from Amazon and eBay" },
    { what: "Reads", effect: "the items and prices in those emails, matched to your rows" },
  ],
  promises: [
    "Read-only: nothing is sent, deleted or changed in your mail.",
    "Read by jaskmoney's own code: no AI model reads your email. Jev sees only the items found, with the row.",
    "Executor holds your Google sign-in: jaskmoney never sees a Google password or token.",
    "Remove access any time at executor.sh or in your Google account.",
  ],
}
