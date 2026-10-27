import type { Category } from "./types"

/**
 * Nerd Font glyphs (Font Awesome 4 range, U+F000–U+F2E0, unchanged across
 * Nerd Fonts v2 and v3) for Up's categories by Up category id, and for the
 * app's own top-level categories by name. Every glyph is one cell wide in a
 * "Nerd Font Mono" face.
 */
const UP_ICONS: Record<string, number> = {
  // Groups
  "good-life": 0xf118, // smile-o
  personal: 0xf007, // user
  home: 0xf015, // home
  transport: 0xf1b9, // car
  // Good Life
  adult: 0xf070, // eye-slash
  "games-and-software": 0xf11b, // gamepad
  booze: 0xf000, // glass
  "events-and-gigs": 0xf145, // ticket
  hobbies: 0xf1fc, // paint-brush
  "holidays-and-travel": 0xf072, // plane
  "lottery-and-gambling": 0xf219, // diamond
  "pubs-and-bars": 0xf0fc, // beer
  "restaurants-and-cafes": 0xf0f5, // cutlery
  "tv-and-music": 0xf26c, // television
  takeaway: 0xf290, // shopping-bag
  "tobacco-and-vaping": 0xf0c2, // cloud
  // Home
  groceries: 0xf07a, // shopping-cart
  "homeware-and-appliances": 0xf1e6, // plug
  internet: 0xf1eb, // wifi
  "home-maintenance-and-improvements": 0xf0ad, // wrench
  pets: 0xf1b0, // paw
  "home-insurance-and-rates": 0xf132, // shield
  "rent-and-mortgage": 0xf084, // key
  utilities: 0xf0e7, // bolt
  // Personal
  family: 0xf1ae, // child
  "clothing-and-accessories": 0xf27e, // black-tie
  "education-and-student-loans": 0xf19d, // graduation-cap
  "fitness-and-wellbeing": 0xf21e, // heartbeat
  "gifts-and-charity": 0xf06b, // gift
  "hair-and-beauty": 0xf0c4, // scissors
  "health-and-medical": 0xf0fa, // medkit
  investments: 0xf201, // line-chart
  "life-admin": 0xf046, // check-square-o
  "mobile-phone": 0xf10b, // mobile
  "news-magazines-and-books": 0xf1ea, // newspaper-o
  technology: 0xf109, // laptop
  // Transport
  "car-insurance-and-maintenance": 0xf0ad, // wrench
  cycling: 0xf206, // bicycle
  fuel: 0xf043, // tint
  parking: 0xf041, // map-marker
  "public-transport": 0xf238, // train
  "car-repayments": 0xf09d, // credit-card
  "taxis-and-share-cars": 0xf1ba, // taxi
  "toll-roads": 0xf018, // road
}

const LOCAL_ICONS: Record<string, number> = {
  income: 0xf0d6, // money
  transfers: 0xf0ec, // exchange
  people: 0xf0c0, // users
  uncategorised: 0xf128, // question
}

/** Up's id for a category named as Up names it ("Rent & Mortgage" →
 * "rent-and-mortgage"), for one without an Up id (the demo, a CSV import);
 * two ids differ from their names. */
const UP_ID_BY_NAME: Record<string, string> = { "tv-music-and-streaming": "tv-and-music", "apps-games-and-software": "games-and-software" }
function upIdFromName(name: string): string {
  const slug = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return UP_ID_BY_NAME[slug] ?? slug
}

/** The category's glyph: by Up id (its own, else the one its name would
 * have), else by its own name, else its group's; null when none is known
 * (callers fall back to a dot). */
export function categoryIcon(category: Category | undefined, categories: Category[]): string | null {
  if (!category) return null
  const code = UP_ICONS[category.extId ?? upIdFromName(category.name)] ?? LOCAL_ICONS[category.name.toLowerCase()]
  if (code != null) return String.fromCodePoint(code)
  const parent = category.parentId != null ? categories.find((c) => c.id === category.parentId) : undefined
  return parent ? categoryIcon(parent, categories) : null
}
