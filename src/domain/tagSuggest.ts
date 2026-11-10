import { newestFirst } from "./chronology"
import type { JevClient } from "../ai/jev"
import { judgeEach } from "../ai/judge"
import { ASK_LIMIT } from "./ask"
import { examplesOf } from "./history"
import { descKey } from "./transactionGroups"
import { tagQuestion, tagState } from "./questions"
import { tripWindow, type TagGroup } from "./tagGroups"
import { tagCovers } from "./tagScope"
import type { Category, Transaction } from "./types"

export interface TagTarget {
  tagId: number | null
  name: string
  categoryIds: number[]
  about: string | null
  group?: TagGroup
}

export interface TagCandidate {
  transactionId: number
  confidence: number
  source: "group" | "history" | "jev"
}

export function tagPool(target: TagTarget, transactions: Transaction[], categories: Category[]): Transaction[] {
  const dates = tripDates(target.group)
  const inScope = dates ? (t: Transaction) => t.dateISO >= dates.from && t.dateISO <= dates.to : tagCovers(target, categories)
  return transactions.filter((t) => (target.tagId == null || !t.tagIds.includes(target.tagId)) && inScope(t))
}

export function tagExamples(target: TagTarget, transactions: Transaction[], limit = 8): string[] {
  const tagId = target.tagId
  if (tagId == null) return []
  return examplesOf(transactions.filter((t) => t.tagIds.includes(tagId)), limit)
}

export function knownTagCandidates(target: TagTarget, transactions: Transaction[], categories: Category[]): TagCandidate[] {
  const pool = new Set(tagPool(target, transactions, categories).map((t) => t.id))
  const out = new Map<number, TagCandidate>()
  for (const row of target.group?.rows ?? []) {
    if (pool.has(row.id)) out.set(row.id, { transactionId: row.id, confidence: row.confidence, source: "group" })
  }
  if (target.tagId != null) {
    const totals = new Map<string, { tagged: number; all: number }>()
    for (const t of transactions) {
      const entry = totals.get(descKey(t)) ?? { tagged: 0, all: 0 }
      entry.all++
      if (t.tagIds.includes(target.tagId)) entry.tagged++
      totals.set(descKey(t), entry)
    }
    for (const t of transactions) {
      if (!pool.has(t.id) || out.has(t.id)) continue
      const { tagged, all } = totals.get(descKey(t))!
      if (!tagged) continue
      out.set(t.id, { transactionId: t.id, confidence: (tagged / all) * (tagged / (tagged + 1)), source: "history" })
    }
  }
  return [...out.values()]
}

export async function jevTagCandidates(
  jev: Pick<JevClient, "judge">,
  target: TagTarget,
  rows: Transaction[],
  examples: string[],
  options: { onCandidates?: (candidates: TagCandidate[]) => void; onError?: (error: unknown) => void; active?: () => boolean } = {},
): Promise<void> {
  const newest = [...rows].sort(newestFirst).slice(0, ASK_LIMIT)
  const about = [target.about?.trim(), groupAbout(target.group)].filter(Boolean).join("; ")
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

function groupAbout(group?: TagGroup): string | undefined {
  if (!group) return undefined
  if (group.kind === "trip") return `A trip away: ${group.detail} (${group.name.replace(/ \w{3} \d{4}$/, "")}); spending at home before or after it is not part of it`
  return `Regular payments: ${group.detail}`
}

export const TAG_SHOW_AT = 0.5

export function tripDates(group?: TagGroup): { from: string; to: string } | null {
  if (group?.kind !== "trip" || !group.start || !group.end) return null
  return tripWindow(group.start, group.end)
}

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "")

export function groupForTag(tagName: string, groups: TagGroup[]): TagGroup | undefined {
  const name = squash(tagName)
  const year = /(?:19|20)\d\d/.exec(tagName)?.[0]
  return groups.find((g) => {
    if (g.kind === "recurring") return name.includes("subscri")
    const place = squash(g.name.replace(/ \w{3} \d{4}$/, ""))
    return !!place && name.includes(place) && (!year || g.start?.startsWith(year) === true)
  })
}
