import type { ImportProfile } from "./types"

export function matchingProfiles(profiles: ImportProfile[], filename: string): ImportProfile[] {
  const lower = filename.toLowerCase()
  const matches = profiles.filter((p) => p.importPrefix && lower.startsWith(p.importPrefix.toLowerCase()))
  const longest = Math.max(0, ...matches.map((p) => p.importPrefix.length))
  return matches.filter((p) => p.importPrefix.length === longest).sort((a, b) => a.name.localeCompare(b.name))
}
