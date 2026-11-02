import { expect, test } from "bun:test"
import { theme } from "../../theme"
import { leadingEmoji, saverInks } from "./saverInks"

test("a saver's emoji, without its variation selector; none for a plain name", () => {
  expect(leadingEmoji("🏖️ Holiday")).toBe("🏖")
  expect(leadingEmoji("💰 General")).toBe("💰")
  expect(leadingEmoji("Rainy day")).toBeNull()
})

test("each saver takes its emoji's colour", () => {
  expect(saverInks(["💰 General", "🏖️ Holiday", "🚨 Emergency"])).toEqual([theme.yellow, theme.sky, theme.red])
})

test("savers whose emoji share a colour are kept apart; the first keeps its own", () => {
  const inks = saverInks(["🏖️ Beach", "🌊 Surf", "❄️ Ski", "💧 Water"])
  expect(inks[0]).toBe(theme.sky)
  expect(new Set(inks).size).toBe(4)
  // Sky and sapphire read alike, so the second sea saver doesn't get sapphire.
  expect(inks).not.toContain(theme.sapphire)
})

