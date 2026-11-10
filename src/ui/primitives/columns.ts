const WIDE = 90
const GRID_PANE_MIN = 64
const SIDE_MIN = 40

function sideColumnWidth(width: number, max: number, share: number): number {
  return Math.max(SIDE_MIN, Math.min(max, Math.floor((width - 1) * share)))
}

interface Columns { wide: boolean; grid: boolean; side: number; main: number; left: number; right: number }

export function tabColumns(width: number, side: { max: number; share: number; narrow: (width: number) => number }): Columns {
  const wide = width >= WIDE
  const sideWidth = wide ? sideColumnWidth(width, side.max, side.share) : side.narrow(width)
  const main = wide ? width - 1 - sideWidth : width
  return {
    wide, side: sideWidth, main,
    grid: wide && main >= 2 * GRID_PANE_MIN + 1,
    left: Math.ceil((main - 1) / 2), right: Math.floor((main - 1) / 2),
  }
}
