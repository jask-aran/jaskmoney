import { For } from "solid-js"
import { theme } from "../../theme"
import { S } from "./S"

/**
 * Up's mark for the Overview's top-right corner: a yellow triangle with "up"
 * in coral, as quadrant-block pixel art five rows tall (the tab bar, the gap
 * and the Date Range). Traced from the brand mark. Each cell has a glyph, an
 * ink and a paper; "." is the row's own background (the tab bar's on the
 * first row, the canvas below).
 */
const GLYPHS = [
  "     ▟▙     ",
  "    ▟  ▙    ",
  " ▟▌▟ ▐▐ ▝▜▙ ",
  " ▜▝▗ ▐▐ ▖▟  ",
  "▗ ▝   ▐  ▟ ▖",
]
const INK = [
  ".....YY.....",
  "....Y..Y....",
  ".CCY.YC.CCC.",
  ".CYC.YC.CC..",
  "Y.C...C..Y.Y",
]
const PAPER = [
  "............",
  ".....YY.....",
  "....CCYCY...",
  "..CYCCYCYYC.",
  ".YYYYYYCYCY.",
]
const UP_YELLOW = "#ffe94f"
const UP_CORAL = "#ff7461"

export const UP_LOGO_WIDTH = GLYPHS[0]!.length
export const UP_LOGO_HEIGHT = GLYPHS.length

function colour(code: string, row: number): string {
  if (code === "Y") return UP_YELLOW
  if (code === "C") return UP_CORAL
  return row === 0 ? theme.mantle : theme.canvas
}

export function UpLogo() {
  return (
    <box position="absolute" top={0} right={0} zIndex={1} width={UP_LOGO_WIDTH} height={UP_LOGO_HEIGHT} flexDirection="column">
      <For each={GLYPHS}>
        {(glyphs, y) => (
          <text height={1} wrapMode="none">
            {[...glyphs].map((ch, x) => {
              const paper = colour(PAPER[y()]![x]!, y())
              return <S fg={ch === " " ? paper : colour(INK[y()]![x]!, y())} bg={paper}>{ch}</S>
            })}
          </text>
        )}
      </For>
    </box>
  )
}
