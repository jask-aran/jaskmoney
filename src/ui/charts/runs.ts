import type { Run } from "./lineChart"

const graphemes = new Intl.Segmenter()

export function textCells(text: string): string[] {
  if (!/[\ud800-\udfff\u200d\ufe0f]/.test(text) && Bun.stringWidth(text) === text.length) return text.split("")
  return [...graphemes.segment(text)].flatMap(({ segment }) => [segment, ...Array<string>(Math.max(0, Bun.stringWidth(segment) - 1)).fill("")])
}

export function appendRun(runs: Run[], text: string, ink: string | null): void {
  const last = runs[runs.length - 1]
  if (last && last.ink === ink) last.text += text
  else runs.push({ text, ink })
}

export function cellsToRuns(cells: Run[]): Run[] {
  const runs: Run[] = []
  for (const cell of cells) appendRun(runs, cell.text, cell.ink)
  return runs
}

export function cellGrid(rows: Run[][]) {
  const cells: Array<Run[] | undefined> = new Array(rows.length)
  const written = new Uint8Array(rows.length)
  const row = (r: number): Run[] => (cells[r] ??= rows[r]!.flatMap((run) => textCells(run.text).map((text) => ({ text, ink: run.ink }))))
  return {
    height: rows.length,
    row,
    set(r: number, c: number, cell: Run): void {
      row(r)[c] = cell
      written[r] = 1
    },
    runs: (): Run[][] => rows.map((runs, r) => (written[r] ? cellsToRuns(cells[r]!) : merged(runs) ? runs : cellsToRuns(row(r)))),
  }
}

function merged(runs: Run[]): boolean {
  for (let i = 0; i < runs.length; i++) if (!runs[i]!.text || (i > 0 && runs[i]!.ink === runs[i - 1]!.ink)) return false
  return true
}
