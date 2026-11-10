export type StatusEntry =
  | { id: number; at: number; text: string; level: "info" | "error" }
  | { id: number; at: number; withdraws: number }

export function latestStatus(log: readonly StatusEntry[]): { text: string; level: "info" | "error" } {
  const withdrawn = new Set<number>()
  for (let i = log.length - 1; i >= 0; i--) {
    const entry = log[i]!
    if ("withdraws" in entry) withdrawn.add(entry.withdraws)
    else if (!withdrawn.has(entry.id)) return { text: entry.text, level: entry.level }
  }
  return { text: "", level: "info" }
}
