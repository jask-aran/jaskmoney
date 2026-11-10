import { theme, whenThemeChanges } from "../../theme"

const LINE_NAMES = ["red", "peach", "yellow", "green", "teal", "sky", "sapphire", "blue", "lavender", "mauve", "pink"] as const
type LineColour = (typeof LINE_NAMES)[number]
const LINE_COLOURS = {} as Record<LineColour, string>
whenThemeChanges(() => { for (const name of LINE_NAMES) LINE_COLOURS[name] = theme[name] })

const EMOJI: Record<LineColour, string> = {
  red: "🚨❤🍎🍓🌹🎁🧧🍒🚒🍅🎈⛑🩸🆘📍🔴🥊🧨🎯🚗🏎🌶🥩🏥🛑",
  peach: "🍊🎃🦊🧡🔥🏀🥕🍑🦁🐯🍂🍁🚧🟠🏜🏠🏡🐶🍔☕🎸🥐🍕🧱🏘",
  yellow: "💰🪙💛⭐🌟☀🌞🍋🍌🌻🏆🥇👑💡🐝🧀🟡🚕🎉🍺🐱🐥🌽🎗",
  green: "💚🌱🌿🍀🌳🌲🥑🥦🐢🐸💵💸🟢🌵🥝♻🎄⚽🥗🍏🌴🧩",
  teal: "🐬🧊🦚🏝🩵🪴",
  sky: "❄🌊💧🐳🐋🏊🌐🌍🌏🏔🛫✈🧳🛳⛵🏖⛱",
  sapphire: "💎🚙🛁🚿",
  blue: "💙🔵📘💻📱⌨🖥🏦💳🛒👖👟🏋🎽🚲🚌📚🎓",
  lavender: "🛏🪻",
  mauve: "💜🔮🍇🍆🎮👾🦄☂🎵🎶🟣🎭🎤",
  pink: "💖💗💕🌸🎀🐷🦩💅👶🍼💍🎂🛍🧁👗💐",
}
const BY_EMOJI = new Map<string, LineColour>()
for (const [colour, emoji] of Object.entries(EMOJI) as Array<[LineColour, string]>) {
  for (const e of emoji) BY_EMOJI.set(e, colour)
}

export function leadingEmoji(name: string): string | null {
  const first = [...new Intl.Segmenter().segment(name.trim())][0]?.segment ?? ""
  return /\p{Extended_Pictographic}/u.test(first) ? first.replace(/[︎️]/g, "") : null
}

const hue = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b)
  if (!d) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
const apart = (a: string, b: string) => {
  const d = Math.abs(hue(a) - hue(b))
  return Math.min(d, 360 - d)
}
const MIN_APART = 16

function preferred(name: string): LineColour {
  const emoji = leadingEmoji(name)
  const known = emoji ? BY_EMOJI.get(emoji) ?? BY_EMOJI.get([...emoji][0]!) : undefined
  if (known) return known
  const keys = Object.keys(LINE_COLOURS) as LineColour[]
  let h = 0
  for (const c of name) h = (h * 31 + c.codePointAt(0)!) >>> 0
  return keys[h % keys.length]!
}

export function saverInks(names: string[]): string[] {
  const taken: string[] = []
  return names.map((name) => {
    const want = LINE_COLOURS[preferred(name)]
    const free = Object.values(LINE_COLOURS).filter((c) => taken.every((t) => apart(c, t) >= MIN_APART))
    const pick = free.includes(want) ? want : free.sort((a, b) => apart(a, want) - apart(b, want))[0] ?? want
    taken.push(pick)
    return pick
  })
}
