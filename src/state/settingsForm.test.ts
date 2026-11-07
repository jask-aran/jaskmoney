import { describe, expect, test } from "bun:test"
import { cycleFor } from "../domain/budget"
import { anchorDraft, cycleFromDraft } from "./settingsForm"

describe("settings form", () => {
  test("drafts turn into stored cycles and back", () => {
    expect(cycleFromDraft({ unit: "month", anchor: "date", anchorDate: "15th" })).toEqual({ unit: "month", anchor: "date", anchorDate: "2000-01-15", payEarly: false })
    expect(cycleFromDraft({ unit: "month", anchor: "date", anchorDate: "32" })).toBe("Day must be 1–31")
    expect(cycleFromDraft({ unit: "week", anchor: "date", anchorDate: "Thursday" })).toEqual({ unit: "week", anchor: "date", anchorDate: "1970-01-08", payEarly: false })
    expect(cycleFromDraft({ unit: "fortnight", anchor: "date", anchorDate: "2026-02-30" })).toBe("Date must be YYYY-MM-DD")
    expect(cycleFromDraft({ unit: "month", anchor: "calendar", anchorDate: "anything" })).toEqual({ unit: "month", anchor: "calendar", anchorDate: null, payEarly: false })
    // Old full-date anchors read back in the unit's form.
    expect(anchorDraft({ unit: "month", anchor: "date", anchorDate: "2026-10-15" })).toBe("15")
    expect(anchorDraft({ unit: "week", anchor: "date", anchorDate: "2026-10-15" })).toBe("Thursday")
    // A monthly 15th cycles from the 15th whatever year the anchor names.
    const stored = cycleFromDraft({ unit: "month", anchor: "date", anchorDate: "15" })
    expect(typeof stored !== "string" && cycleFor(stored, "2026-10-26")).toMatchObject({ start: "2026-10-15", end: "2026-11-14" })
  })
})
