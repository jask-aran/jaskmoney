import { Index, Show, type JSX } from "solid-js"
import type { MouseEvent } from "@opentui/core"
import { ink, theme, tone } from "../../theme"
import { wrapText } from "../../state/textLayout"
import type { IntegrationUse } from "../../state/integrationUses"
import { StyledLine, type StyledSpan } from "./StyledLine"

export type CardLine = { spans: StyledSpan[]; row?: number }
export const blank: CardLine = { spans: [] }
export const say = (text: string, fg: string = ink.label, bold = false): CardLine => ({ spans: [{ text, fg, bold }] })
export const wrapped = (text: string, width: number, fg: string = ink.label): CardLine[] =>
  wrapText(text, Math.max(10, width)).map((t) => ({ spans: [{ text: t, fg }] }))

export function labelled(label: string, value: string, width: number, fg: string = ink.figure, labelWidth = 12): CardLine[] {
  return wrapText(value, Math.max(10, width - labelWidth)).map((t, i) => ({ spans: [{ text: (i === 0 ? label : "").padEnd(labelWidth), fg: ink.label }, { text: t, fg }] }))
}

export function numbered(items: readonly (readonly [string, string])[], width: number): CardLine[] {
  return items.flatMap(([n, text]) =>
    wrapText(text, width - 4).map((t, i) => ({ spans: [{ text: i === 0 ? ` ${n}  ` : "    ", fg: tone.key, bold: true }, { text: t, fg: ink.figure }] })))
}

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

export function noteLines(note: { text: string; ok: boolean | null }, width: number): CardLine[] {
  const fg = note.ok === true ? tone.good : note.ok === false ? tone.bad : ink.note
  return wrapText(note.text, width - 3).map((t, i) => ({ spans: [{ text: i === 0 ? (note.ok === true ? " ✓ " : note.ok === false ? " ✗ " : " · ") : "   ", fg, bold: true }, { text: t, fg }] }))
}

export function usesLines(use: IntegrationUse, width: number): CardLine[] {
  const out: CardLine[] = [say(use.title, ink.heading, true), ...wrapped(use.why, width, ink.note), blank]
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
