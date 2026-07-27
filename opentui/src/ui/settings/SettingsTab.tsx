import { For } from "solid-js"
import { SectionCard } from "../primitives/SectionCard"
import { S } from "../primitives/S"
import type { SectionId } from "../../state/uiStore"
import { data } from "../../state/dataStore"
import { theme } from "../../theme"

export function SettingsTab(props: { focused: SectionId }) {
  const info = () => data.state.dbInfo

  return (
    <box width="100%" height="100%" flexDirection="row" gap={1} backgroundColor={theme.base}>
      <box flexGrow={1} flexDirection="column" gap={0} height="100%">
        <SectionCard title="Categories" focused={props.focused === "set.categories"} flexGrow={1}>
          <For each={data.state.categories}>
            {(c) => (
              <text>
                <S fg={c.color}>● </S>
                <S fg={theme.text}>{c.name}</S>
                {c.isDefault ? <S fg={theme.overlay1}> (default)</S> : null}
              </text>
            )}
          </For>
        </SectionCard>
        <SectionCard title="Tags" focused={props.focused === "set.tags"} flexGrow={1}>
          <For each={data.state.tags}>
            {(t) => (
              <text>
                <S fg={t.color}>● </S>
                <S fg={theme.text}>{t.name}</S>
              </text>
            )}
          </For>
        </SectionCard>
        <SectionCard title="Rules" focused={props.focused === "set.rules"} flexGrow={1}>
          <text fg={theme.overlay1}>Out of MVP</text>
        </SectionCard>
        <SectionCard title="Saved Filters" focused={props.focused === "set.filters"} flexGrow={1}>
          <text fg={theme.overlay1}>Out of MVP · use / in Manager</text>
        </SectionCard>
      </box>
      <box flexGrow={1} flexDirection="column" gap={0} height="100%">
        <SectionCard title="Chart Views" flexGrow={1}>
          <text fg={theme.overlay1}>Week anchor / grid — later</text>
        </SectionCard>
        <SectionCard title="Database" flexGrow={1}>
          <text fg={theme.subtext0}>
            Schema version:  <S fg={theme.text}>v{info()?.schemaVersion ?? "—"}</S>
          </text>
          <text fg={theme.subtext0}>
            Transactions:    <S fg={theme.text}>{info()?.transactionCount ?? 0}</S>
          </text>
          <text fg={theme.subtext0}>
            Categories:      <S fg={theme.text}>{info()?.categoryCount ?? 0}</S>
          </text>
          <text fg={theme.subtext0}>
            Tags:            <S fg={theme.text}>{info()?.tagCount ?? 0}</S>
          </text>
          <text fg={theme.subtext0}>
            Accounts:        <S fg={theme.text}>{info()?.accountCount ?? 0}</S>
          </text>
          <text fg={theme.subtext0}>
            Imports:         <S fg={theme.text}>{info()?.importCount ?? 0}</S>
          </text>
          <text fg={theme.overlay1}>Path: {info()?.path ?? "—"}</text>
          {data.state.lastIngestSummary ? (
            <text fg={theme.teal}>{data.state.lastIngestSummary}</text>
          ) : null}
        </SectionCard>
      </box>
    </box>
  )
}
