import { expect, test } from "bun:test"
import { data } from "./dataStore"
import { ui } from "./uiStore"
import { handleKey } from "../app/keys"
import { key } from "../testing/keys"
import { settlePending } from "../testing/settle"

/**
 * The Transactions table shows all rows, the uncategorised ones, or a tag
 * review's candidates: never two at once — frozen: change the code, not these.
 */
test("i from the Overview during a tag review ends the review: the table isn't both", async () => {
  data.init(":memory:")
  void data.openTagReview({ tagId: null, name: "Trip", categoryIds: [], about: null })
  await settlePending()
  expect(data.state.tagReview).not.toBeNull()
  ui.switchTab("overview")
  handleKey(ui, key("i"), data)
  expect(data.state.uncategorisedOnly).toBe(true)
  expect(data.state.tagReview).toBeNull()
  data.setUncategorisedOnly(false)
})
