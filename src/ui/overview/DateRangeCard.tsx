import { For, Show, createMemo } from "solid-js"
import { keyEvent } from "../../app/keyEvent"
import { handleOverviewRange, stepOverviewRange } from "../../app/keys"
import { onPointer } from "../../app/pointer"
import { appNow } from "../../domain/days"
import { CUSTOM_CHIP, LOOKBACKS, PERIODS, rangeOffsetLabel, PERIOD_LABEL, type PeriodId } from "../../domain/timeframe"
import { data } from "../../state/dataStore"
import { ui, type SectionId } from "../../state/uiStore"
import { ink, tone } from "../../theme"
import { chipLook } from "../primitives/chip"
import { S } from "../primitives/S"
import { SectionCard } from "../primitives/SectionCard"
import { UP_LOGO_WIDTH } from "../primitives/UpLogo"
import { regionRef } from "../regions"
import type { OverviewModel } from "./overviewModel"
import { panePointer } from "./RangePane"

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
interface ChipLayout { gap: string; separator: string; label: (period: PeriodId) => string; timeframe: boolean; groups: boolean }

/** The chip families' names, before each family where there's room: the
 * code's own names for them (TimeframeState's family). */
const GROUP_NAMES = { lookback: "Lookback", period: "Period" } as const

const SHORT: Partial<Record<PeriodId, string>> = { cycle: "Bud", month: "Mth", year: "Yr" }

const TIERS = [
  { gap: " ", separator: " │ ", label: (p: PeriodId) => PERIOD_LABEL[p], groups: true },
  { gap: " ", separator: " │ ", label: (p: PeriodId) => PERIOD_LABEL[p] },
  { gap: "", separator: "│", label: (p: PeriodId) => PERIOD_LABEL[p] },
  { gap: "", separator: "│", label: (p: PeriodId) => SHORT[p] ?? PERIOD_LABEL[p] },
]

/** The chips' width in a tier: each label padded by a space either side. */
function chipsWidth(tier: Omit<ChipLayout, "timeframe" | "groups"> & { groups?: boolean }): number {
  const chips = [...LOOKBACKS, ...PERIODS.map(tier.label), "Custom"].reduce((n, label) => n + label.length + 2, 0)
  const gaps = (LOOKBACKS.length - 1 + PERIODS.length - 1) * tier.gap.length
  // A name and a space before each family.
  const names = tier.groups ? GROUP_NAMES.lookback.length + 1 + GROUP_NAMES.period.length + 1 : 0
  return chips + gaps + 2 * tier.separator.length + names
}

/** `inner`: the card's content width; `timeframe`: the dates' width (with a 2-column gap). */
function chipLayout(inner: number, timeframe: number): ChipLayout {
  const withDates = TIERS.slice(0, 3).find((tier) => chipsWidth(tier) + 2 + timeframe <= inner)
  if (withDates) return { groups: false, ...withDates, timeframe: true }
  return { groups: false, ...(TIERS.find((tier) => chipsWidth(tier) <= inner) ?? TIERS.at(-1)!), timeframe: false }
}

type DateInput = OverviewModel & { focused: () => SectionId }

export function createDateChips(input: DateInput) {
  const { dims, bounds, cycleConfig, focused } = input
  // The dates on the right, between the [ ] that step them, and how far
  // the range is from the current period (with 0 to come back).
  const offsetText = createMemo(() => rangeOffsetLabel(ui.state.timeframe, appNow(), cycleConfig()))
  const timeframeWidth = () => bounds().label.length + 4 + (offsetText() ? offsetText().length + 11 : 0)
  // The card leaves the Up logo its columns; border and padding take 4.
  const rangeCardWidth = () => Math.max(20, dims().width - UP_LOGO_WIDTH - 1)
  const chipsFit = createMemo(() => chipLayout(rangeCardWidth() - 4, timeframeWidth()))
  const showTimeframe = () => chipsFit().timeframe
  const dateFocused = () => focused() === "ov.range"
  // Chips are padded labels on a pill (chipLook); the cursor shows only
  // while the Date Range is focused.
  const chip = (label: string, idx: number, active: () => boolean) => {
    // `active` is a function: For runs its callback once per chip, so a plain
    // boolean would keep the first render's value.
    const look = () => chipLook({ active: active(), cursor: dateFocused() && ui.state.dashChipCursor === idx })
    return <S fg={look().fg} bg={look().bg} bold={look().bold}>{` ${label} `}</S>
  }
  // The space between chips: none when the row is tight (an empty text
  // would still take a column).
  const gap = () => <text wrapMode="none" fg={ink.label}>{chipsFit().gap}</text>
  const stepPointer = (delta: -1 | 1) => onPointer((s) => s === "bar" || s === "overview" || s === "overview.range", () => stepOverviewRange(ui, delta, data))
  /** A range chip as its own text: a click on it chooses it. */
  const chipText = (label: string, idx: number, active: () => boolean) => (
    <text wrapMode="none" fg={ink.label} onMouseDown={onPointer((s) => s === "bar" || s === "overview" || s === "overview.range", () => {
      ui.applyJump("ov.range")
      ui.setDashChipCursor(idx)
      handleOverviewRange(ui, keyEvent("return"), data)
    })}>{chip(label, idx, active)}</text>
  )

  return { rangeCardWidth, dateFocused, chipsFit, gap, chipText, showTimeframe, offsetText, stepPointer }
}

export function DateRangeCard(input: DateInput & ReturnType<typeof createDateChips>) {
  const { scope, bounds } = input
  const { rangeCardWidth, dateFocused, chipsFit, gap, chipText, showTimeframe, offsetText, stepPointer } = input
  return (
      <box ref={regionRef("ov.range", "overview")} width={rangeCardWidth()} height={3} flexShrink={0} onMouseDown={panePointer("ov.range")}>
      <SectionCard title="Date Range" titleSuffix={`· ${scope().label}`} titleSuffixColor={ink.label} focused={dateFocused()} height={3} width={rangeCardWidth()}>
        <box flexDirection="row" justifyContent="space-between" width="100%">
          {/* Each chip its own text: a click lands on the chip OpenTUI drew
              there, with no sums of label widths to keep in step. */}
          <box flexDirection="row" flexShrink={0}>
            <Show when={chipsFit().groups}><text wrapMode="none" fg={ink.heading}><b>{`${GROUP_NAMES.lookback} `}</b></text></Show>
            <For each={LOOKBACKS}>
              {(lb, i) => <><Show when={i() > 0 && chipsFit().gap}>{gap()}</Show>{chipText(lb, i(), () => ui.state.timeframe.family === "lookback" && ui.state.timeframe.lookback === lb)}</>}
            </For>
            <text wrapMode="none" fg={ink.rule}>{chipsFit().separator}</text>
            <Show when={chipsFit().groups}><text wrapMode="none" fg={ink.heading}><b>{`${GROUP_NAMES.period} `}</b></text></Show>
            <For each={PERIODS}>
              {(p, i) => <><Show when={i() > 0 && chipsFit().gap}>{gap()}</Show>{chipText(chipsFit().label(p), LOOKBACKS.length + i(), () => ui.state.timeframe.family === "period" && ui.state.timeframe.period === p)}</>}
            </For>
            <text wrapMode="none" fg={ink.rule}>{chipsFit().separator}</text>
            {chipText("Custom", CUSTOM_CHIP, () => ui.state.timeframe.family === "custom")}
          </box>
          {/* The dates, between the [ and ] that step them (a click on
              one steps too), after how far back the period is. */}
          <Show when={showTimeframe()}>
            <box flexDirection="row" flexShrink={0}>
              <Show when={offsetText()}>
                <text wrapMode="none">
                  <S fg={ink.note}>{`${offsetText()} · `}</S>
                  <S fg={tone.key} bold>{"0"}</S>
                  <S fg={ink.note}>{" now   "}</S>
                </text>
              </Show>
              <text wrapMode="none" onMouseDown={stepPointer(-1)}><S fg={tone.key} bold>{"["}</S></text>
              <text wrapMode="none" fg={tone.scope}>{` ${bounds().label} `}</text>
              <text wrapMode="none" onMouseDown={stepPointer(1)}><S fg={tone.key} bold>{"]"}</S></text>
            </box>
          </Show>
        </box>
      </SectionCard>
      </box>
  )
}
