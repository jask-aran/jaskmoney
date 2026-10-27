import type { DemoCategory } from "./demo"

/** Public Up category names; no account or transaction data enters this list. */
export const DEMO_CATEGORIES: readonly DemoCategory[] = [
  ...[
    { name: "Home", color: "#89b4fa", children: ["Groceries", "Rent & Mortgage", "Utilities", "Internet", "Homeware & Appliances", "Home Maintenance & Improvements", "Pets", "Home Insurance & Rates"] },
    { name: "Good Life", color: "#fab387", children: ["Restaurants & Cafes", "Takeaway", "Pubs & Bars", "Booze", "TV, Music & Streaming", "Apps, Games & Software", "Holidays & Travel", "Events & Gigs", "Hobbies", "Adult", "Lottery & Gambling", "Tobacco & Vaping"] },
    { name: "Personal", color: "#cba6f7", children: ["Clothing & Accessories", "Health & Medical", "Hair & Beauty", "Fitness & Wellbeing", "Gifts & Charity", "Technology", "Mobile Phone", "Family", "Education & Student Loans", "Investments", "Life Admin", "News, Magazines & Books"] },
    { name: "Transport", color: "#f9e2af", children: ["Fuel", "Public Transport", "Taxis & Share Cars", "Parking", "Toll Roads", "Cycling", "Car Repayments", "Car Insurance & Maintenance"] },
  ].flatMap(group => [
    { name: group.name, color: group.color, parent: null },
    ...group.children.map(name => ({ name, color: group.color, parent: group.name })),
  ]),
  { name: "Income", color: "#a6e3a1", parent: null, income: true },
  { name: "Salary", color: "#a6e3a1", parent: "Income", income: true },
  { name: "Interest", color: "#a6e3a1", parent: "Income", income: true },
  { name: "Transfers", color: "#94e2d5", parent: null, notSpending: true },
  { name: "People", color: "#f5c2e7", parent: null },
]

/** Rates are per category, per month; amounts are AUD medians. */
export const MERCHANTS = [
  { category: "Groceries", names: ["Coles", "Woolworths", "ALDI", "IGA", "Harris Farm Markets", "Bakers Delight", "The Source Bulk Foods"], amount: 90, spread: 0.3, frequency: 4.5, essential: true },
  { category: "Restaurants & Cafes", names: ["Gloria Jean's", "Seven Seeds", "Patricia Coffee Brewers", "Market Lane Coffee", "Pellegrini's", "Chin Chin", "Grill'd", "Din Tai Fung"], amount: 17, spread: 0.65, frequency: 19, essential: false },
  { category: "Takeaway", names: ["Guzman y Gomez", "Zambrero", "Sushi Hub", "Nando's", "Betty's Burgers", "Roll'd", "Domino's", "Fishbowl"], amount: 22, spread: 0.3, frequency: 7, essential: false },
  { category: "Pubs & Bars", names: ["Young Henrys", "The Corner Hotel", "The Espy", "Mountain Goat Brewery", "Moon Dog"], amount: 44, spread: 0.45, frequency: 3, essential: false },
  { category: "Booze", names: ["Dan Murphy's", "BWS", "First Choice Liquor"], amount: 29, spread: 0.3, frequency: 1, essential: false },
  { category: "Fuel", names: ["Ampol", "BP", "7-Eleven", "United Petroleum"], amount: 65, spread: 0.2, frequency: 1.5, essential: true },
  { category: "Public Transport", names: ["myki", "Opal", "Translink"], amount: 9, spread: 0.15, frequency: 11, essential: true },
  { category: "Taxis & Share Cars", names: ["Uber", "DiDi", "13cabs", "GoGet"], amount: 27, spread: 0.4, frequency: 2, essential: false },
  { category: "Clothing & Accessories", names: ["Uniqlo", "Cotton On", "Country Road", "The Iconic", "H&M"], amount: 75, spread: 0.4, frequency: 0.8, essential: false },
  { category: "Health & Medical", names: ["Chemist Warehouse", "Priceline", "TerryWhite Chemmart"], amount: 24, spread: 0.4, frequency: 1.3, essential: true },
  { category: "Hair & Beauty", names: ["Just Cuts", "Oscar Oscar Salons", "Mecca"], amount: 42, spread: 0.25, frequency: 0.6, essential: false },
  { category: "Gifts & Charity", names: ["Typo", "Oxfam Australia", "Readings", "Dymocks"], amount: 40, spread: 0.4, frequency: 0.8, essential: false },
  { category: "Technology", names: ["JB Hi-Fi", "Officeworks", "Jaycar"], amount: 64, spread: 0.4, frequency: 0.4, essential: false },
  { category: "Homeware & Appliances", names: ["Kmart", "Target", "IKEA", "Adairs"], amount: 47, spread: 0.4, frequency: 0.7, essential: false },
  { category: "Home Maintenance & Improvements", names: ["Bunnings", "Mitre 10"], amount: 30, spread: 0.3, frequency: 0.4, essential: false },
  { category: "Events & Gigs", names: ["HOYTS", "Village Cinemas", "Ticketek", "Moshtix"], amount: 42, spread: 0.4, frequency: 1, essential: false },
  { category: "Hobbies", names: ["Spotlight", "Eckersley's", "Good Games"], amount: 32, spread: 0.35, frequency: 0.5, essential: false },
  { category: "News, Magazines & Books", names: ["Readings", "Dymocks", "Booktopia"], amount: 23, spread: 0.3, frequency: 0.5, essential: false },
  { category: "Parking", names: ["Wilson Parking", "Secure Parking"], amount: 12, spread: 0.3, frequency: 1, essential: true },
]

export const PEOPLE = ["Alex Morgan", "Sam Parker", "Jamie Brooks", "Taylor Reed", "Jordan Ellis", "Casey Bell", "Robin Lane", "Riley Stone"]
