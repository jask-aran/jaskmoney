/**
 * How long a chart takes to draw itself in (ChartBody, reveal) when it
 * first shows or its view changes: short, so nobody waits for a chart.
 * 0 draws at once: the default, so tests (and anything that never sets
 * it) see whole charts; the app sets it at start (index.tsx). The tour's
 * demos ask for longer themselves.
 */
export const chartMotion = { ms: 0 }

/** The app's: a fifth of a second. */
export const APP_CHART_MS = 220
