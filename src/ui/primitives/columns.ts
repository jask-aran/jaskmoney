/** At or above this width a tab takes a side column beside its main
 * column of chart panes; below it one column. */
const WIDE = 90
/** A grid pane's narrowest: the main column splits into two columns of
 * panes once each would be at least this wide (a full-screen terminal; a
 * split one keeps them stacked). */
const GRID_PANE_MIN = 64
/** The side column's narrowest: Accounts' labels still fit. */
const SIDE_MIN = 40

/** The side column's width on a wide terminal: `share` of it, between
 * SIDE_MIN and `max`. */
function sideColumnWidth(width: number, max: number, share: number): number {
  return Math.max(SIDE_MIN, Math.min(max, Math.floor((width - 1) * share)))
}

/** A tab's columns, the Overview's and the Budgets tab's: wide, the main
 * column and the side column a gap apart; in the grid, the main column
 * as two columns of panes (`left` and `right` wide, a gap apart).
 * Narrow, the main column is the tab's width and the side `side.narrow`. */
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
