import { Index, Show, type JSX } from "solid-js"
import type { MouseEvent } from "@opentui/core"
import { ink, theme, tone } from "../../theme"
import { wrapText } from "../../state/textLayout"
import type { IntegrationUse } from "../../state/integrationUses"
import { StyledLine, type StyledSpan } from "./StyledLine"

/**
 * The integration card's pieces, shared by the first-run setup (ui/welcome)
 * and Settings' dialogs for Up Bank, the models and Executor: text as
 * lines of spans, wrapped to a column; what an integration does
 * (`usesLines`); numbered steps; a `›` action row; a result note. A card
 * is what to do on the left, and on the right exactly what jaskmoney does
 * with what you're connecting.
 */
export type CardLine = { spans: StyledSpan[]; row?: number }
export const blank: CardLine = { spans: [] }
export const say = (text: string, fg: string = ink.label, bold = false): CardLine => ({ spans: [{ text, fg, bold }] })
export const wrapped = (text: string, width: number, fg: string = ink.label): CardLine[] =>
  wrapText(text, Math.max(10, width)).map((t) => ({ spans: [{ text: t, fg }] }))

/** A label and its value, the value wrapped in a column beside it. */
export function labelled(label: string, value: string, width: number, fg: string = ink.figure, labelWidth = 12): CardLine[] {
  return wrapText(value, Math.max(10, width - labelWidth)).map((t, i) => ({ spans: [{ text: (i === 0 ? label : "").padEnd(labelWidth), fg: ink.label }, { text: t, fg }] }))
}

/** Steps to follow, numbered in the key colour. */
export function numbered(items: readonly (readonly [string, string])[], width: number): CardLine[] {
  return items.flatMap(([n, text]) =>
    wrapText(text, width - 4).map((t, i) => ({ spans: [{ text: i === 0 ? ` ${n}  ` : "    ", fg: tone.key, bold: true }, { text: t, fg: ink.figure }] })))
}

/** An action: `›` and bold at the cursor, on `bg` (the cursor's wash) there. */
export function actionLine(props: { at: boolean; label: string; fg?: string; detail?: string; bg?: string; row?: number }): CardLine {
  const bg = props.at ? props.bg ?? theme.surface0 : undefined
  return {
    row: props.row,
    spans: [
      { text: props.at ? " › " : "   ", fg: tone.key, bold: true, bg },
      { text: props.label, fg: props.fg ?? (props.at ? ink.strong : ink.figure), bold: props.at, bg },
      { text: props.detail ? `  ${props.detail} ` : " ", fg: ink.note, bg },
    ],
  }
}

/** A result: ✓ when it worked, ✗ when it didn't, · for news. */
export function noteLines(note: { text: string; ok: boolean | null }, width: number): CardLine[] {
  const fg = note.ok === true ? tone.good : note.ok === false ? tone.bad : ink.note
  return wrapText(note.text, width - 3).map((t, i) => ({ spans: [{ text: i === 0 ? (note.ok === true ? " ✓ " : note.ok === false ? " ✗ " : " · ") : "   ", fg, bold: true }, { text: t, fg }] }))
}

/** An integration's panel: what it's for, the promises, then what it does
 * (writes marked). Short labels ("Sees") sit in a column beside what they
 * say; long ones (an endpoint) take their own line, what it does beneath. */
export function usesLines(use: IntegrationUse, width: number): CardLine[] {
  const out: CardLine[] = [say(use.title, ink.heading, true), ...wrapped(use.why, width, ink.note), blank]
  // The promises first: on a short screen the list below them is what's cut.
  for (const p of use.promises) wrapText(p, width - 2).forEach((t, i) => out.push({ spans: [{ text: i === 0 ? "✓ " : "  ", fg: tone.good }, { text: t, fg: ink.label }] }))
  out.push(blank)
  const short = use.uses.every((u) => u.what.length <= 10)
  for (const u of use.uses) {
    const fg = u.writes ? tone.caution : ink.figure
    if (short) {
      wrapText(u.effect, Math.max(10, width - 10)).forEach((t, i) => out.push({ spans: [{ text: (i === 0 ? u.what : "").padEnd(10), fg, bold: true }, { text: t, fg: ink.label }] }))
    } else {
      out.push({ spans: [{ text: u.what, fg, bold: true }] })
      wrapText(u.effect, Math.max(10, width - 2)).forEach((t) => out.push({ spans: [{ text: "  " }, { text: t, fg: ink.note }] }))
    }
  }
  return out
}

/** Lines drawn as a column `width` wide on `bg`; a line with a `row` takes
 * `click(row)`'s handler. By place, not by line: a column rebuilt (a caret
 * blinks, a spinner turns) keeps its rows, and an unchanged row is left alone. */
export function CardColumn(props: { lines: CardLine[]; width: number; bg: string; click?: (row: number | undefined) => ((event: MouseEvent) => void) | undefined }) {
  return (
    <box width={props.width} flexDirection="column" flexShrink={0}>
      <Index each={props.lines}>{(line) => (
        <box height={1} width={props.width} onMouseDown={props.click?.(line().row)}>
          <StyledLine spans={line().spans} bg={props.bg} />
        </box>
      )}</Index>
    </box>
  )
}

/** A card's two sides: what to do (`children`), then what it does (`panel`)
 * beside it behind a rule, or, when `beside` is false, under it. */
export function CardSides(props: { beside: boolean; leftWidth: number; rightWidth: number; panel: CardLine[]; bg: string; children: JSX.Element }) {
  return (
    <box flexDirection={props.beside ? "row" : "column"} gap={props.beside ? 3 : 1} flexShrink={0}>
      <box width={props.leftWidth} flexDirection="column" flexShrink={0}>{props.children}</box>
      <Show when={props.panel.length}>
        <box width={props.rightWidth} flexShrink={0} flexDirection="column" border={[props.beside ? "left" : "top"]} borderColor={ink.rule} paddingLeft={props.beside ? 2 : 0}>
          <CardColumn lines={props.panel} width={props.rightWidth - (props.beside ? 3 : 0)} bg={props.bg} />
        </box>
      </Show>
    </box>
  )
}
