import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { filterExprString, parseFilterStrict } from "../domain/filter"
import type { AccountSelection } from "../domain/accountTree"
import { customRange, LOOKBACKS, PERIODS, type TimeframeState } from "../domain/timeframe"
import type { ImportProfile, SavedFilter } from "../domain/types"

export interface UiPrefs {
  filterUsage?: Record<string, string>
  timeframe?: Pick<TimeframeState, "family" | "lookback" | "period" | "custom">
  accountSelection?: AccountSelection
  chartViews?: [number, number]
  weekStart?: "monday" | "sunday"
  /** Charts draw an x-axis line under the plot (default off). */
  xAxis?: boolean
}

export interface SettingsConfig {
  ui?: UiPrefs
  version: 2
  savedFilters: SavedFilter[]
  importProfiles: ImportProfile[]
  /** Nerd Font category icons (off: coloured dots). A per-machine display
   * choice, so it lives here rather than in the database. Default on. */
  icons?: boolean
}

/** The former hard-coded importer is now an ordinary editable profile. It is
 * supplied whenever a config has no profiles, so clearing the database never
 * strands the bundled ANZ.csv fixture. */
export const DEFAULT_IMPORT_PROFILES: ImportProfile[] = [{
  id: "anz", name: "ANZ Credit", account: "ANZ CREDIT", accountType: "credit",
  importPrefix: "anz", hasHeader: false, delimiter: ",", dateColumn: 0,
  amountColumn: 1, descriptionColumns: [2], descriptionJoin: true, amountStrip: "$", dateFormat: "DMY",
}]

function defaultProfiles(): ImportProfile[] { return DEFAULT_IMPORT_PROFILES.map((profile) => ({ ...profile, descriptionColumns: [...profile.descriptionColumns] })) }

const EMPTY: SettingsConfig = { version: 2, savedFilters: [], importProfiles: defaultProfiles() }

/** JASKMONEY_CONFIG overrides the path (tests point it at a scratch file). */
export function defaultSettingsConfigPath(): string {
  if (process.env.JASKMONEY_CONFIG) return process.env.JASKMONEY_CONFIG
  return join(process.env.XDG_CONFIG_HOME ?? join(process.env.HOME ?? ".", ".config"), "jaskmoney-opentui", "settings.json")
}

export function normalizeSavedFilterId(raw: string): string {
  const id = raw.trim().toLowerCase()
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(id)) throw new Error("filter ID must be 1–63 chars: a-z, 0-9, _ or -, starting with a-z or 0-9")
  return id
}

export function nextSavedFilterId(filters: SavedFilter[]): string {
  const ids = new Set(filters.map((f) => f.id.toLowerCase()))
  for (let n = 1; n < 10000; n++) if (!ids.has(`filter-${n}`)) return `filter-${n}`
  throw new Error("could not allocate a saved-filter ID")
}

export function validateSavedFilter(filter: SavedFilter, other: SavedFilter[] = []): SavedFilter {
  const id = normalizeSavedFilterId(filter.id)
  const name = filter.name.trim()
  if (!name) throw new Error("filter name is required")
  const expr = filter.expr.trim()
  const { node, error } = parseFilterStrict(expr)
  if (!node || error) throw new Error(error ?? "filter expression is required")
  if (other.some((f) => f.id.toLowerCase() === id)) throw new Error(`filter ID ${id} already exists`)
  return { id, name, expr: filterExprString(node) }
}

export function validateImportProfile(profile: ImportProfile): ImportProfile {
  const id = normalizeSavedFilterId(profile.id)
  if (!profile.name.trim() || !profile.account.trim()) throw new Error("profile name and account are required")
  if (profile.accountType !== "debit" && profile.accountType !== "credit") throw new Error("profile account type must be debit or credit")
  if (profile.delimiter.length !== 1) throw new Error("profile delimiter must be one character")
  for (const column of [profile.dateColumn, profile.amountColumn, ...profile.descriptionColumns]) {
    if (!Number.isInteger(column) || column < 0) throw new Error("profile column indices must be non-negative integers")
  }
  if (profile.dateFormat !== "DMY" && profile.dateFormat !== "MDY" && profile.dateFormat !== "YMD") throw new Error("profile date format must be DMY, MDY, or YMD")
  return { ...profile, id, name: profile.name.trim(), account: profile.account.trim(), importPrefix: profile.importPrefix.trim() }
}

function parseUiPrefs(raw: unknown): UiPrefs | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const ui: UiPrefs = {}
  if ("filterUsage" in raw && raw.filterUsage && typeof raw.filterUsage === "object" && !Array.isArray(raw.filterUsage)) {
    ui.filterUsage = Object.fromEntries(Object.entries(raw.filterUsage).filter((entry): entry is [string, string] => typeof entry[1] === "string" && Number.isFinite(Date.parse(entry[1]))))
  }
  if ("weekStart" in raw && (raw.weekStart === "monday" || raw.weekStart === "sunday")) ui.weekStart = raw.weekStart
  if ("xAxis" in raw && typeof raw.xAxis === "boolean") ui.xAxis = raw.xAxis
  if ("accountSelection" in raw) {
    const sel = raw.accountSelection
    if (sel === "all" || sel === "savers" || (typeof sel === "number" && Number.isSafeInteger(sel) && sel > 0)) ui.accountSelection = sel
  }
  if ("chartViews" in raw && Array.isArray(raw.chartViews) && raw.chartViews.length === 2) {
    const [a, b] = raw.chartViews
    if (typeof a === "number" && Number.isSafeInteger(a) && a >= 0 && typeof b === "number" && Number.isSafeInteger(b) && b >= 0) ui.chartViews = [a, b]
  }
  if ("timeframe" in raw && raw.timeframe && typeof raw.timeframe === "object") {
    const tf = raw.timeframe
    const lookback = LOOKBACKS.find((id) => "lookback" in tf && id === tf.lookback)
    const period = PERIODS.find((id) => "period" in tf && id === tf.period)
    let custom: TimeframeState["custom"] = null
    let validCustom = "custom" in tf && tf.custom === null
    if ("custom" in tf && tf.custom && typeof tf.custom === "object" && "start" in tf.custom && "end" in tf.custom && typeof tf.custom.start === "string" && typeof tf.custom.end === "string") {
      const range = customRange(tf.custom.start, tf.custom.end)
      if (typeof range !== "string") { custom = range; validCustom = true }
    }
    if ("family" in tf && (tf.family === "lookback" || tf.family === "period" || (tf.family === "custom" && custom)) && lookback && period && validCustom) {
      ui.timeframe = { family: tf.family, lookback, period, custom }
    }
  }
  return ui
}

export function loadSettingsConfig(path = defaultSettingsConfigPath()): SettingsConfig {
  if (!existsSync(path)) return { ...EMPTY, savedFilters: [], importProfiles: defaultProfiles() }
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"))
  if (!parsed || typeof parsed !== "object") throw new Error("settings config must be an object")
  const raw = parsed as Omit<Partial<SettingsConfig>, "version"> & { version?: number; importProfiles?: unknown[] }
  if (raw.version !== 1 && raw.version !== 2) throw new Error(`unsupported settings config version ${String(raw.version)}`)
  const savedFilters = Array.isArray(raw.savedFilters) ? raw.savedFilters.map((f) => validateSavedFilter(f as SavedFilter)) : []
  const seen = new Set<string>()
  for (const filter of savedFilters) {
    if (seen.has(filter.id)) throw new Error(`duplicate saved filter ID ${filter.id}`)
    seen.add(filter.id)
  }
  // v1 had profile records but no explicit date order; its only importer was
  // ANZ, whose legacy date layout is D/M/YYYY.
  const importProfiles = Array.isArray(raw.importProfiles)
    ? raw.importProfiles.map((p) => validateImportProfile({ dateFormat: "DMY", ...(p as Omit<ImportProfile, "dateFormat">) }))
    : []
  return { version: 2, savedFilters, importProfiles: importProfiles.length ? importProfiles : defaultProfiles(), icons: raw.icons !== false, ui: parseUiPrefs("ui" in raw ? raw.ui : undefined) }
}

/** Rename is atomic on the same filesystem; a config write can therefore
 * never leave a partially written settings document. */
export function saveSettingsConfig(config: SettingsConfig, path = defaultSettingsConfigPath()): void {
  const dir = dirname(path)
  mkdirSync(dir, { recursive: true })
  const normalized: SettingsConfig = {
    version: 2,
    savedFilters: config.savedFilters.map((f, i, all) => validateSavedFilter(f, all.filter((_, j) => j !== i))),
    importProfiles: config.importProfiles.map(validateImportProfile),
    icons: config.icons !== false,
    ui: parseUiPrefs(config.ui),
  }
  if (normalized.ui?.filterUsage) normalized.ui.filterUsage = Object.fromEntries(Object.entries(normalized.ui.filterUsage).filter(([id]) => normalized.savedFilters.some((filter) => filter.id === id)))
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  try {
    writeFileSync(temp, `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 })
    renameSync(temp, path)
  } finally {
    // rename consumed the temp file; deliberately do not delete the target on failure.
  }
}
