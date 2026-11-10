import { categoryIcon } from "../domain/categoryIcons"
import { unwrap } from "solid-js/store"
import { data } from "../state/dataStore"
import { lazyMemo } from "../client/lazyMemo"

export function categoryMark(categoryId: number | null | undefined, muted = false): string {
  if (data.state.icons) {
    const icon = icons().get(categoryId ?? -1)
    if (icon) return icon
  }
  return muted ? "○" : "●"
}

const icons = lazyMemo(() => {
  const categories = unwrap(data.state.categories)
  void data.state.categories.length
  return new Map(categories.flatMap((c) => { const icon = categoryIcon(c, categories); return icon ? [[c.id, icon] as const] : [] }))
})

const VIEW_ICONS: Record<string, string> = {
  Cumulative: "\uf201",
  Daily: "\uf080",
  Weekly: "\uf0db",
  "Cash flow": "\uf0ec",
  "Net position": "\uf19c",
  Available: "\uf09d",
  Savers: "\uf0d6",
  Calendar: "\uf073",
  Merchants: "\uf07a",
  Trends: "\uf1fe",
  Subscriptions: "\uf021",
  "Each cycle": "\uf03a",
  Categories: "\uf0ca",
}

export function viewMark(view: string, current: boolean): string {
  if (data.state.icons && VIEW_ICONS[view]) return VIEW_ICONS[view]!
  return current ? "●" : "○"
}

export function accountMark(kind: "net" | "spending" | "savers"): string {
  if (!data.state.icons) return ""
  return VIEW_ICONS[kind === "net" ? "Net position" : kind === "spending" ? "Available" : "Savers"]!
}

const SETTING_ICONS = {
  token: "",
  sync: "",
  accounts: "",
  setup: "",
  theme: "",
  icons: "",
  xAxis: "",
  chartMotion: "",
  chartSpeed: "",
  chartCurve: "",
  chartLabels: "",
  openRange: "",
  backdrop: "",
  database: "",
  import: "",
  history: "",
  profiles: "",
  weekStart: "",
  demo: "",
  clearData: "",
  reset: "",
  rule: "",
  filter: "",
} as const
export type SettingIcon = keyof typeof SETTING_ICONS

export function settingMark(icon: SettingIcon, fallback = ""): string {
  return data.state.icons ? SETTING_ICONS[icon] : fallback
}
