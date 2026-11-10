import { Show, type JSX } from "solid-js"
import type { FilterNote } from "../../domain/filter"
import { ACCEPT_ALL_AT } from "../../domain/questions"
import { ink, tone } from "../../theme"
import { S } from "../primitives/S"
import { SectionCard } from "../primitives/SectionCard"
import { TextInput } from "../primitives/TextInput"
import { Spinner } from "../primitives/Spinner"
import { muted } from "../primitives/spans"
import { truncate } from "../text"

export interface FilterBarView {
  editing: boolean
  raw: string
  caret: number
  err: string
  note: FilterNote | null
  question: string | null
  jev: boolean
  writing: boolean
  drillReturn: boolean
  preview: string
}

function filterBarLook(fb: FilterBarView) {
  const flag = fb.note?.tone === "warn" ? "check" : fb.err ? "parse" : "ok"
  const dot = flag === "check" ? tone.caution : flag === "parse" ? tone.bad : ink.note
  const asking = fb.editing && fb.raw.trimStart().startsWith("?")
  const noteFg = fb.note?.tone === "error" ? tone.bad : fb.note?.tone === "warn" ? tone.caution : ink.note
  return { flag, dot, asking, noteFg }
}

function filterTitle(fb: FilterBarView | null): string | undefined {
  if (fb?.question) return `[?${truncate(fb.question, 47)}]`
  if (!fb?.preview) return undefined
  return `[${truncate(fb.preview, 48)}]`
}

export function rowsShown(p: { top: number; visible: number; count: number; total: number; selected: number; hidden: number; range: boolean; sort: string; ascending: boolean }): string | undefined {
  if (p.count === 0) return undefined
  const start = p.top + 1
  const end = Math.min(p.top + p.visible, p.count)
  return `showing ${start}-${end} of ${p.count}${p.total !== p.count ? ` (${p.total.toLocaleString("en-AU")} in all)` : ""}${
    p.selected > 0 ? ` · ${p.selected} selected${p.hidden ? `, ${p.hidden} hidden` : ""}` : ""
  }${p.range ? " · range" : ""} · sort ${p.sort}${p.ascending ? "↑" : "↓"}`
}

export function rowsToCategorise(p: { count: number; suggested: number; confident: number; suggesting: boolean; selected: number; hidden: number }): string | undefined {
  if (p.count === 0) return undefined
  return `${p.count} to categorise · ${p.suggested} suggested, ${p.confident} ≥${ACCEPT_ALL_AT * 100}%${p.suggesting ? " · suggesting…" : ""}${
    p.selected > 0 ? ` · ${p.selected} selected${p.hidden ? `, ${p.hidden} hidden` : ""}` : ""}`
}

export function TransactionsPane(props: {
  title: string
  filter: FilterBarView | null
  focused: boolean
  width: number
  height?: number
  flexGrow?: number
  bottom?: string
  children: JSX.Element
}) {
  return (
    <SectionCard
      title={props.title}
      titleSuffix={filterTitle(props.filter)}
      titleSuffixColor={props.filter?.err ? tone.bad : tone.scope}
      focused={props.focused}
      active={props.focused}
      width={props.width}
      height={props.height}
      flexGrow={props.flexGrow}
      bottomSpans={props.bottom ? [muted(props.bottom)] : []}
    >
      <Show when={props.filter}>
        {(fb: () => FilterBarView) => <FilterBar fb={fb()} width={props.width} />}
      </Show>
      {props.children}
    </SectionCard>
  )
}

function FilterBar(props: { fb: FilterBarView; width: number }) {
  const look = () => filterBarLook(props.fb)
  const room = (used: number) => Math.max(8, props.width - 4 - used)
  return (
    <Show when={!look().asking} fallback={
      <text>
        <S fg={tone.key} bold>?</S>
        <S fg={ink.figure}>{" "}</S>
        <TextInput field={{ value: props.fb.raw.trimStart().slice(1), caret: Math.max(0, props.fb.caret - 1) }} focused={!props.fb.writing} caretColor={tone.key} />
        {props.fb.writing ? <><S fg={tone.ai}>{"  "}</S><Spinner fg={tone.ai} /><S fg={tone.ai}>{" Jev is writing the filter"}</S></> : null}
      </text>
    }>
      <Show when={props.fb.question} fallback={
        <text>
          <S fg={tone.key} bold>/</S>
          <S fg={ink.figure}>{" "}</S>
          <TextInput field={{ value: props.fb.raw, caret: props.fb.caret }} focused={props.fb.editing} caretColor={tone.key} />
          <S fg={ink.figure}>{"  "}</S>
          <S fg={look().dot}>●</S>
          <S fg={look().dot}> {look().flag}</S>
          {props.fb.note ? <S fg={look().noteFg}>{`  ${truncate(props.fb.note.text, room(14 + props.fb.raw.length + (props.fb.jev ? 22 : 0) + (props.fb.editing ? 0 : 18)))}`}</S> : null}
          {props.fb.jev ? <S fg={tone.ai}>{"  ◆ ask: judged by Jev"}</S> : null}
          {!props.fb.editing ? <S fg={ink.note}>{props.fb.drillReturn ? "  (esc back · u clear)" : "  (esc clear)"}</S> : null}
        </text>
      }>
        {(question: () => string) => (
          <text>
            <S fg={tone.key} bold>?</S>
            <S fg={ink.figure}>{` ${question()}`}</S>
            <S fg={ink.note}>{"  → "}</S>
            <TextInput field={{ value: props.fb.raw, caret: props.fb.caret }} focused={props.fb.editing} fg={tone.ai} caretColor={tone.key} />
            {look().flag !== "ok" ? <S fg={look().dot}>{`  ● ${look().flag}`}</S> : null}
            {props.fb.note && look().flag !== "ok" ? <S fg={look().noteFg}>{`  ${truncate(props.fb.note.text, room(10 + question().length + props.fb.raw.length))}`}</S> : null}
            {props.fb.jev ? <S fg={tone.ai}>{"  ◆ ask: judged by Jev"}</S> : null}
            <S fg={ink.note}>{props.fb.editing ? "  (↑ the question)" : props.fb.drillReturn ? "  (esc back · u clear)" : "  (esc clear)"}</S>
          </text>
        )}
      </Show>
    </Show>
  )
}
