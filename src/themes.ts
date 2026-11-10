import type { Palette } from "./theme"

export type BasePalette = Pick<Palette,
  "rosewater" | "flamingo" | "pink" | "mauve" | "red" | "maroon" | "peach" | "yellow" | "green" | "teal" | "sky" | "sapphire" | "blue" | "lavender"
  | "text" | "subtext1" | "subtext0" | "overlay2" | "overlay1" | "overlay0" | "surface2" | "surface1" | "surface0" | "base" | "mantle" | "crust"
> & Partial<Palette>

export interface ThemeDef {
  id: string
  name: string
  colors: BasePalette
}

export const THEMES: readonly ThemeDef[] = [
  {
    id: "jaskmoney",
    name: "Jaskmoney",
    colors: {
      rosewater: "#f5e0dc", flamingo: "#f2cdcd", pink: "#f5c2e7", mauve: "#cba6f7", red: "#f38ba8", maroon: "#eba0ac", peach: "#fab387",
      yellow: "#f9e2af", green: "#a6e3a1", teal: "#94e2d5", sky: "#89dceb", sapphire: "#74c7ec", blue: "#89b4fa", lavender: "#b4befe",
      text: "#cdd6f4", subtext1: "#bac2de", subtext0: "#a6adc8", overlay2: "#9399b2", overlay1: "#7f849c", overlay0: "#6c7086",
      surface2: "#585b70", surface1: "#45475a", surface0: "#313244", base: "#1e1e2e", mantle: "#181825", crust: "#11111b",
      chartToday: "#66d690", chartBudget: "#a8996b", strong: "#ffffff", figure: "#e6e6e6",
    },
  },
  {
    id: "mocha",
    name: "Catppuccin Mocha",
    colors: {
      rosewater: "#f5e0dc", flamingo: "#f2cdcd", pink: "#f5c2e7", mauve: "#cba6f7", red: "#f38ba8", maroon: "#eba0ac", peach: "#fab387",
      yellow: "#f9e2af", green: "#a6e3a1", teal: "#94e2d5", sky: "#89dceb", sapphire: "#74c7ec", blue: "#89b4fa", lavender: "#b4befe",
      text: "#cdd6f4", subtext1: "#bac2de", subtext0: "#a6adc8", overlay2: "#9399b2", overlay1: "#7f849c", overlay0: "#6c7086",
      surface2: "#585b70", surface1: "#45475a", surface0: "#313244", base: "#1e1e2e", mantle: "#181825", crust: "#11111b",
    },
  },
  {
    id: "tokyo-night",
    name: "Tokyo Night",
    colors: {
      rosewater: "#f4dbd6", flamingo: "#f7a8b8", pink: "#ff9ece", mauve: "#bb9af7", red: "#f7768e", maroon: "#db4b4b", peach: "#ff9e64",
      yellow: "#e0af68", green: "#9ece6a", teal: "#73daca", sky: "#7dcfff", sapphire: "#2ac3de", blue: "#7aa2f7", lavender: "#a9b8f5",
      text: "#c0caf5", subtext1: "#a9b1d6", subtext0: "#9aa5ce", overlay2: "#828bb8", overlay1: "#737aa2", overlay0: "#565f89",
      surface2: "#414868", surface1: "#3b4261", surface0: "#292e42", base: "#1a1b26", mantle: "#16161e", crust: "#101014",
    },
  },
  {
    id: "gruvbox",
    name: "Gruvbox Dark",
    colors: {
      rosewater: "#f2d5cf", flamingo: "#e8a8a0", pink: "#d3869b", mauve: "#d3869b", red: "#fb4934", maroon: "#cc241d", peach: "#fe8019",
      yellow: "#fabd2f", green: "#b8bb26", teal: "#8ec07c", sky: "#83a598", sapphire: "#689d6a", blue: "#83a598", lavender: "#a8b5a3",
      text: "#ebdbb2", subtext1: "#d5c4a1", subtext0: "#bdae93", overlay2: "#a89984", overlay1: "#928374", overlay0: "#7c6f64",
      surface2: "#665c54", surface1: "#504945", surface0: "#3c3836", base: "#282828", mantle: "#1d2021", crust: "#161819",
      strong: "#fbf1c7", figure: "#ebdbb2",
    },
  },
  {
    id: "rose-pine",
    name: "Rosé Pine",
    colors: {
      rosewater: "#f2e9e1", flamingo: "#ebbcba", pink: "#ebbcba", mauve: "#c4a7e7", red: "#eb6f92", maroon: "#b4637a", peach: "#ea9a97",
      yellow: "#f6c177", green: "#9ccfd8", teal: "#56949f", sky: "#9ccfd8", sapphire: "#3e8fb0", blue: "#3e8fb0", lavender: "#c4a7e7",
      text: "#e0def4", subtext1: "#cfcce6", subtext0: "#908caa", overlay2: "#817c9c", overlay1: "#6e6a86", overlay0: "#5c5874",
      surface2: "#524f67", surface1: "#403d52", surface0: "#26233a", base: "#1f1d2e", mantle: "#191724", crust: "#12101a",
    },
  },
  {
    id: "nord",
    name: "Nord",
    colors: {
      rosewater: "#e5d4cf", flamingo: "#d8a6a6", pink: "#b48ead", mauve: "#b48ead", red: "#d0757e", maroon: "#bf616a", peach: "#d08770",
      yellow: "#ebcb8b", green: "#a3be8c", teal: "#8fbcbb", sky: "#88c0d0", sapphire: "#81a1c1", blue: "#81a1c1", lavender: "#9fb4d8",
      text: "#eceff4", subtext1: "#e5e9f0", subtext0: "#d8dee9", overlay2: "#aeb6c4", overlay1: "#8f99ab", overlay0: "#6f7a8e",
      surface2: "#4c566a", surface1: "#434c5e", surface0: "#3b4252", base: "#2e3440", mantle: "#272c36", crust: "#21252d",
    },
  },
]

export const DEFAULT_THEME = "jaskmoney"
