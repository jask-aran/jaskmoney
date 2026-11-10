import type { Category } from "./types"

const UP_ICONS: Record<string, number> = {
  "good-life": 0xf118,
  personal: 0xf007,
  home: 0xf015,
  transport: 0xf1b9,
  adult: 0xf070,
  "games-and-software": 0xf11b,
  booze: 0xf000,
  "events-and-gigs": 0xf145,
  hobbies: 0xf1fc,
  "holidays-and-travel": 0xf072,
  "lottery-and-gambling": 0xf219,
  "pubs-and-bars": 0xf0fc,
  "restaurants-and-cafes": 0xf0f5,
  "tv-and-music": 0xf26c,
  takeaway: 0xf290,
  "tobacco-and-vaping": 0xf0c2,
  groceries: 0xf07a,
  "homeware-and-appliances": 0xf1e6,
  internet: 0xf1eb,
  "home-maintenance-and-improvements": 0xf0ad,
  pets: 0xf1b0,
  "home-insurance-and-rates": 0xf132,
  "rent-and-mortgage": 0xf084,
  utilities: 0xf0e7,
  family: 0xf1ae,
  "clothing-and-accessories": 0xf27e,
  "education-and-student-loans": 0xf19d,
  "fitness-and-wellbeing": 0xf21e,
  "gifts-and-charity": 0xf06b,
  "hair-and-beauty": 0xf0c4,
  "health-and-medical": 0xf0fa,
  investments: 0xf201,
  "life-admin": 0xf046,
  "mobile-phone": 0xf10b,
  "news-magazines-and-books": 0xf1ea,
  technology: 0xf109,
  "car-insurance-and-maintenance": 0xf0ad,
  cycling: 0xf206,
  fuel: 0xf043,
  parking: 0xf041,
  "public-transport": 0xf238,
  "car-repayments": 0xf09d,
  "taxis-and-share-cars": 0xf1ba,
  "toll-roads": 0xf018,
}

const LOCAL_ICONS: Record<string, number> = {
  income: 0xf0d6,
  transfers: 0xf0ec,
  people: 0xf0c0,
  uncategorised: 0xf128,
}

const UP_ID_BY_NAME: Record<string, string> = { "tv-music-and-streaming": "tv-and-music", "apps-games-and-software": "games-and-software" }
function upIdFromName(name: string): string {
  const slug = name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  return UP_ID_BY_NAME[slug] ?? slug
}

export function categoryIcon(category: Category | undefined, categories: Category[]): string | null {
  if (!category) return null
  const code = UP_ICONS[category.extId ?? upIdFromName(category.name)] ?? LOCAL_ICONS[category.name.toLowerCase()]
  if (code != null) return String.fromCodePoint(code)
  const parent = category.parentId != null ? categories.find((c) => c.id === category.parentId) : undefined
  return parent ? categoryIcon(parent, categories) : null
}
