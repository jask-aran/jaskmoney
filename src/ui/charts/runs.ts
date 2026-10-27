import type { Run } from "./lineChart"

/** Append text, merging only adjacent runs with the same ink. */
export function appendRun(runs: Run[], text: string, ink: string | null): void {
  const last = runs[runs.length - 1]
  if (last && last.ink === ink) last.text += text
  else runs.push({ text, ink })
}

/** Merge chart cells into runs with the same ink. */
export function cellsToRuns(cells: Run[]): Run[] {
  const runs: Run[] = []
  for (const cell of cells) appendRun(runs, cell.text, cell.ink)
  return runs
}
