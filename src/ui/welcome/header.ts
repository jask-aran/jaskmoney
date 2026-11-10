import { ink, mix, tone } from "../../theme"
import { STEP_NAMES, WELCOME_STEPS, stepMark, type WelcomeContext, type WelcomeState } from "../../state/welcome"
import type { StyledSpan } from "../primitives/StyledLine"

const LETTERS: Record<string, [string, string]> = {
  J: ["  █", "█▄█"], A: ["▄▀█", "█▀█"], S: ["█▀", "▄█"], K: ["█▄▀", "█ █"], M: ["█▀▄▀█", "█ ▀ █"],
  O: ["█▀█", "█▄█"], N: ["█▄ █", "█ ▀█"], E: ["█▀▀", "██▄"], Y: ["█▄█", " █ "],
}
const TITLE: [string, string] = [0, 1].map((r) => [..."JASKMONEY"].map((c) => LETTERS[c]![r]).join(" ")) as [string, string]

const SHEEN_EVERY = 40
const SHEEN_FRAMES = 18
export function titleSpans(tick: () => number, r: 0 | 1): StyledSpan[] {
  const text = TITLE[r], n = text.length
  const f = tick() % SHEEN_EVERY
  const sweep = f < SHEEN_FRAMES ? (f / SHEEN_FRAMES) * (n + 24) - 12 - r * 2 : -99
  const drift = (Math.sin(tick() / 25) + 1) / 2
  return [...text].map((ch, x) => {
    const d = Math.abs(x - sweep)
    const core = Math.max(0, 1 - d / 2)
    const glow = Math.max(0, 1 - d / 9)
    const base = mix(tone.key, tone.focus, Math.min(1, Math.max(0, x / n * 0.8 + drift * 0.4 - 0.1)))
    return { text: ch, fg: mix(mix(base, tone.focus, glow * 0.6), ink.strong, Math.min(1, core * 1.2 + glow * 0.25)), bold: true }
  })
}

export function railSegments(state: () => WelcomeState, ctx: () => WelcomeContext, since: () => number): Array<{ step: WelcomeState["step"]; spans: StyledSpan[]; width: number }> {
  const at = WELCOME_STEPS.indexOf(state().step)
  return WELCOME_STEPS.map((step, i) => {
    const spans: StyledSpan[] = []
    if (i > 0) {
      const lit = i <= at ? (i === at ? Math.min(5, since()) : 5) : 0
      spans.push({ text: " " + "━".repeat(lit), fg: tone.key }, { text: "─".repeat(5 - lit) + " ", fg: ink.rule })
    }
    const mark = stepMark(step, state(), ctx())
    spans.push(
      { text: step === "done" ? (mark === "ahead" ? "☆ " : "★ ") : mark === "done" ? "✓ " : mark === "skipped" ? "– " : mark === "current" ? "● " : "○ ", fg: mark === "done" ? tone.good : mark === "current" ? tone.key : ink.faint, bold: true },
      { text: STEP_NAMES[step], fg: mark === "current" ? ink.strong : mark === "done" ? ink.label : ink.faint, bold: mark === "current" },
    )
    return { step, spans, width: spans.reduce((n, s) => n + Bun.stringWidth(s.text), 0) }
  })
}
