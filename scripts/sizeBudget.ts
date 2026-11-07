/**
 * The size budget (scripts/lint.ts): about 20% over the sizes on
 * 2026-11-08, after the tests were cut to a third. Lines are non-blank
 * lines; characters are non-whitespace ones (so lines can't be packed to
 * dodge the line counts). Over a limit, cut: never raise one to make room.
 *
 * Baseline: 304 tests in 113 files, 7,516 lines, 386,272 characters;
 * source (src and scripts, not tests) 308 files, 40,073 lines,
 * 1,951,665 characters; 11 dependencies.
 */
export const BUDGET = {
  testCount: 365,
  testFiles: 136,
  testLines: 9_019,
  testChars: 463_526,
  sourceFiles: 370,
  sourceLines: 48_088,
  sourceChars: 2_341_998,
}

/** The most a package may depend on (dependencies and devDependencies). */
export const MAX_DEPENDENCIES = 13

/** The most lines (non-blank) any file may have. */
export const FILE_LINES = 600

/** The files already past FILE_LINES, held at about their size then (to
 * the next 50 lines): they may shrink, never grow past it. Split them as
 * they're worked on, and lower or remove their entry when they shrink. */
export const FROZEN_FILES: Record<string, number> = {
  "src/app/keys.ts": 2_800,
  "src/db/client.ts": 1_000,
  "src/domain/filter.ts": 950,
  "src/state/uiStore.ts": 900,
  "src/ui/settings/SettingsTab.tsx": 850,
  "src/ui/overview/OverviewTab.tsx": 800,
  "src/core/core.ts": 750,
  "src/client/store.ts": 750,
  "src/ui/budgets/BudgetsTab.tsx": 700,
  "src/web/tabs/overview/periodCharts.ts": 650,
  "src/ui/overview/periodCharts.ts": 650,
}
