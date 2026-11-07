import { LOOKBACKS, PERIODS, PERIOD_LABEL, type PeriodId } from "../../domain/timeframe"

/**
 * How the Date Range card's chips fit its width: the roomiest spacing that
 * fits, tightening before anything is cut. Named: full, with each family's
 * name (Lookback, Period) before its chips, the first to go. Full: a space
 * between chips and
 * " │ " between groups; tight: chips side by side (their own padding
 * separates them) and a bare "│"; short: tight with the long period labels
 * shortened. The dates on the right show with full labels only (the
 * roomiest spacing that leaves them room); labels aren't shortened for them.
 */
export interface ChipLayout { gap: string; separator: string; label: (period: PeriodId) => string; timeframe: boolean; groups: boolean }

/** The chip families' names, before each family where there's room: the
 * code's own names for them (TimeframeState's family). */
export const GROUP_NAMES = { lookback: "Lookback", period: "Period" } as const

const SHORT: Partial<Record<PeriodId, string>> = { cycle: "Bud", month: "Mth", year: "Yr" }

const TIERS = [
  { gap: " ", separator: " │ ", label: (p: PeriodId) => PERIOD_LABEL[p], groups: true },
  { gap: " ", separator: " │ ", label: (p: PeriodId) => PERIOD_LABEL[p] },
  { gap: "", separator: "│", label: (p: PeriodId) => PERIOD_LABEL[p] },
  { gap: "", separator: "│", label: (p: PeriodId) => SHORT[p] ?? PERIOD_LABEL[p] },
]

/** The chips' width in a tier: each label padded by a space either side. */
export function chipsWidth(tier: Omit<ChipLayout, "timeframe" | "groups"> & { groups?: boolean }): number {
  const chips = [...LOOKBACKS, ...PERIODS.map(tier.label), "Custom"].reduce((n, label) => n + label.length + 2, 0)
  const gaps = (LOOKBACKS.length - 1 + PERIODS.length - 1) * tier.gap.length
  // A name and a space before each family.
  const names = tier.groups ? GROUP_NAMES.lookback.length + 1 + GROUP_NAMES.period.length + 1 : 0
  return chips + gaps + 2 * tier.separator.length + names
}

/** `inner`: the card's content width; `timeframe`: the dates' width (with a 2-column gap). */
export function chipLayout(inner: number, timeframe: number): ChipLayout {
  const withDates = TIERS.slice(0, 3).find((tier) => chipsWidth(tier) + 2 + timeframe <= inner)
  if (withDates) return { groups: false, ...withDates, timeframe: true }
  return { groups: false, ...(TIERS.find((tier) => chipsWidth(tier) <= inner) ?? TIERS.at(-1)!), timeframe: false }
}
