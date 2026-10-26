/** Case-insensitive subsequence score; larger scores are better. */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase()
  const label = text.toLowerCase()
  if (!q) return 0
  let from = 0, previous = -2, score = q.length
  for (const char of q) {
    const at = label.indexOf(char, from)
    if (at < 0) return null
    if (from === 0 && at === 0) score += 10
    if (at === previous + 1) score += 3
    if (at === 0 || /[\s_/-]/.test(label[at - 1]!)) score += 2
    previous = at
    from = at + char.length
  }
  if (label === q) score += 20
  return score + 1 / (label.length + 1)
}

export function fuzzyFilter<T>(items: T[], query: string, textOf: (item: T) => string): T[] {
  if (!query) return items
  return items.map((item) => ({ item, score: fuzzyScore(query, textOf(item)) }))
    .filter((entry): entry is { item: T; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item)
}
