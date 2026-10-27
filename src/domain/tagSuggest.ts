import { judgeEach, type JevClient } from "../ai/jev"
import { ASK_LIMIT } from "./ask"
import { tagQuestion, tagState } from "./questions"
import { tripWindow, type TagGroup } from "./tagGroups"
import { inTagScope } from "./tagScope"
import type { Transaction } from "./types"

/**
 * Finding the transactions a tag belongs on. A target is an existing tag, a
 * tag a detected group would create (a trip, subscriptions), or a name just
 * typed. Candidates come only from the tag's scope and never include rows
 * already carrying it: a detected group's rows first, then rows sharing a
 * description with rows already tagged, then Jev's judgement of the rest.
 */
export interface TagTarget {
  /** The tag, when it exists. */
  tagId: number | null
  name: string
  scope: string | null
  /** The detected group behind it, when there is one. */
  group?: TagGroup
}

export interface TagCandidate {
  transactionId: number
  /** 0–1, as category suggestions' (ACCEPT_ALL_AT applies). */
  confidence: number
  source: "group" | "history" | "jev"
}

/** Rows the tag could still go on: in its scope, not already tagged. */
export function tagPool(target: TagTarget, transactions: Transaction[]): Transaction[] {
  return transactions.filter((t) => (target.tagId == null || !t.tagIds.includes(target.tagId)) && inTagScope(target, t))
}

const key = (t: Transaction) => t.description.trim().toLowerCase()

/** Up to `limit` descriptions of rows already tagged, the most common first:
 * Jev's examples of what the tag means. */
export function tagExamples(target: TagTarget, transactions: Transaction[], limit = 8): string[] {
  if (target.tagId == null) return []
  const counts = new Map<string, { label: string; n: number }>()
  for (const t of transactions) {
    if (!t.tagIds.includes(target.tagId)) continue
    const entry = counts.get(key(t)) ?? { label: t.description.trim(), n: 0 }
    entry.n++
    counts.set(key(t), entry)
  }
  return [...counts.values()].sort((a, b) => b.n - a.n).slice(0, limit).map((e) => e.label)
}

/**
 * Candidates known without Jev: the group's rows (as detected), and rows
 * whose description the tag is already on: share tagged × n / (n + 1), so
 * one tagged row of one is 0.5 and three of three 0.75. In the pool only.
 */
export function knownTagCandidates(target: TagTarget, transactions: Transaction[]): TagCandidate[] {
  const pool = new Set(tagPool(target, transactions).map((t) => t.id))
  const out = new Map<number, TagCandidate>()
  for (const row of target.group?.rows ?? []) {
    if (pool.has(row.id)) out.set(row.id, { transactionId: row.id, confidence: row.confidence, source: "group" })
  }
  if (target.tagId != null) {
    const totals = new Map<string, { tagged: number; all: number }>()
    for (const t of transactions) {
      const entry = totals.get(key(t)) ?? { tagged: 0, all: 0 }
      entry.all++
      if (t.tagIds.includes(target.tagId)) entry.tagged++
      totals.set(key(t), entry)
    }
    for (const t of transactions) {
      if (!pool.has(t.id) || out.has(t.id)) continue
      const { tagged, all } = totals.get(key(t))!
      if (!tagged) continue
      out.set(t.id, { transactionId: t.id, confidence: (tagged / all) * (tagged / (tagged + 1)), source: "history" })
    }
  }
  return [...out.values()]
}

/**
 * Ask Jev whether the tag belongs on each of `rows` (the pool's newest
 * ASK_LIMIT), with the tag's examples. Candidates arrive per request.
 */
export async function jevTagCandidates(
  jev: Pick<JevClient, "judge">,
  target: TagTarget,
  rows: Transaction[],
  examples: string[],
  options: { onCandidates?: (candidates: TagCandidate[]) => void; onError?: (error: unknown) => void; active?: () => boolean } = {},
): Promise<void> {
  const newest = [...rows].sort((a, b) => b.dateISO.localeCompare(a.dateISO) || b.id - a.id).slice(0, ASK_LIMIT)
  const about = groupAbout(target.group)
  await judgeEach(jev, newest, (t) => tagQuestion(t, examples.length > 0, !!about), tagState(target.name, examples, about), {
    active: options.active,
    onAnswers: (answers) => {
      const found: TagCandidate[] = []
      for (const [t, a] of answers) if (a.type === "noul") found.push({ transactionId: t.id, confidence: a.noul, source: "jev" })
      options.onCandidates?.(found)
    },
    onError: (error) => options.onError?.(error),
  })
}

/** What a detected group is, for Jev: "A trip: 38 in person, 12 more in SGD
 * · 22–25 May 2026 (Singapore)". */
function groupAbout(group?: TagGroup): string | undefined {
  if (!group) return undefined
  if (group.kind === "trip") return `A trip away: ${group.detail} (${group.name.replace(/ \w{3} \d{4}$/, "")}); spending at home before or after it is not part of it`
  return `Regular payments: ${group.detail}`
}

/** Candidates below this aren't shown (Jev's unsure middle and below). */
export const TAG_SHOW_AT = 0.5

/** A trip's scope: its dates, from 3 days before to 14 after (bookings
 * abroad, refunds), as detectTrips gathers its rows. */
export function tripScope(group: TagGroup): string | null {
  if (group.kind !== "trip" || !group.start || !group.end) return null
  const { from, to } = tripWindow(group.start, group.end)
  return `date:${from}..${to}`
}

/** Letters and digits, lower-case: "SINGAPORE 2026" → "singapore2026". */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "")

/**
 * The detected group an existing tag stands for, if any: a trip whose place
 * the tag names (and its year, when the tag has one: "SINGAPORE 2026"), or
 * the regular payments for a tag about subscriptions.
 */
export function groupForTag(tagName: string, groups: TagGroup[]): TagGroup | undefined {
  const name = squash(tagName)
  const year = /(?:19|20)\d\d/.exec(tagName)?.[0]
  return groups.find((g) => {
    if (g.kind === "recurring") return name.includes("subscri")
    const place = squash(g.name.replace(/ \w{3} \d{4}$/, ""))
    return !!place && name.includes(place) && (!year || g.start?.startsWith(year) === true)
  })
}
