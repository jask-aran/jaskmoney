/**
 * Settings › Database & Import as rows (K1): j/k and enter, like every other
 * pane. Toggles flip on enter; Clear data arms (enter again clears); Reset
 * opens the typed RESET confirmation (the one action that wipes everything).
 */
export type DatabaseRow = "import" | "profiles" | "icons" | "weekStart" | "xAxis" | "demo" | "clearData" | "reset"

export const DATABASE_ROWS: readonly DatabaseRow[] = ["import", "profiles", "icons", "weekStart", "xAxis", "demo", "clearData", "reset"]

export interface DatabaseRowContext { icons: boolean; weekStart: "monday" | "sunday"; xAxis: boolean; profiles: number; demo: boolean }

/** A row's label and its current value (toggles), and whether it destroys data. */
export function databaseRow(row: DatabaseRow, ctx: DatabaseRowContext): { label: string; value?: string; danger?: boolean } {
  switch (row) {
    case "import": return { label: "Import a CSV…" }
    case "profiles": return { label: "Import profiles…", value: String(ctx.profiles) }
    case "icons": return { label: "Category icons", value: ctx.icons ? "on (Nerd Font)" : "off" }
    case "weekStart": return { label: "Weeks start on", value: ctx.weekStart === "sunday" ? "Sunday" : "Monday" }
    case "xAxis": return { label: "Charts' $0 line", value: ctx.xAxis ? "on" : "off" }
    case "demo": return { label: "Demo mode", value: ctx.demo ? "on · made-up data (enter: back to yours)" : "off · made-up rows patterned on yours" }
    case "clearData": return { label: "Clear data…", value: "transactions and imports", danger: true }
    case "reset": return { label: "Reset the database…", value: "keeps filters and config", danger: true }
  }
}
