/**
 * Settings › Database & Import as rows (K1): j/k and enter, like every other
 * pane. Toggles flip on enter; Clear data arms (enter again clears); Reset
 * opens the typed RESET confirmation (the one action that wipes everything).
 */
import { DEMO_YEARS } from "../domain/demo"
type DatabaseRow = "import" | "history" | "profiles" | "weekStart" | "demo" | "clearData" | "reset"

export const DATABASE_ROWS: readonly DatabaseRow[] = ["import", "history", "profiles", "weekStart", "demo", "clearData", "reset"]

interface DatabaseRowContext { weekStart: "monday" | "sunday"; profiles: number; demo: boolean; imports?: number }

/** Imports the history dialog shows at once. */
export const IMPORT_HISTORY_ROWS = 12

/** A row's label and its current value (toggles), and whether it destroys data. */
export function databaseRow(row: DatabaseRow, ctx: DatabaseRowContext): { label: string; value?: string; danger?: boolean; on?: boolean; choice?: { index: number; count: number } } {
  switch (row) {
    case "import": return { label: "Import a CSV…" }
    case "history": return { label: "Import history…", value: ctx.imports ? `${ctx.imports} ${ctx.imports === 1 ? "import" : "imports"}` : "none yet" }
    case "profiles": return { label: "Import profiles…", value: String(ctx.profiles) }
    case "weekStart": return { label: "Weeks start on", value: ctx.weekStart === "sunday" ? "Sunday" : "Monday", choice: { index: ctx.weekStart === "sunday" ? 1 : 0, count: 2 } }
    case "demo": return { label: "Demo mode", value: ctx.demo ? "on · made-up data (enter: back)" : `off · ${DEMO_YEARS} years of made-up data`, on: ctx.demo }
    case "clearData": return { label: "Clear data…", value: "transactions and imports", danger: true }
    case "reset": return { label: "Reset the database…", value: "keeps filters and config", danger: true }
  }
}
