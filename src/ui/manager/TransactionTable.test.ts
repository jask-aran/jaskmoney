import { expect, test } from "bun:test"
import { tableLayout } from "./TransactionTable"

// Fixed columns with tags and no account: marker 1, date 9, amount 13 and
// four gaps leave `width - 27` for description, category and tags.
test("the description gets its longest text, then the category, then tags the rest", () => {
  expect(tableLayout(146, false, true, { description: 54, category: 35 })).toMatchObject({ description: 54, category: 35, tags: 30 })
})

test("when space is short, tags keep 8 and category 16 before the description gives way", () => {
  // 124 − 27 = 97: description 54, category 35, tags 8.
  expect(tableLayout(124, false, true, { description: 54, category: 35 })).toMatchObject({ description: 54, category: 35, tags: 8 })
  // 100 − 27 = 73: the description gives way to category 16 and tags 8.
  expect(tableLayout(100, false, true, { description: 54, category: 35 })).toMatchObject({ description: 49, category: 16, tags: 8 })
  // Without tags (and their gap) the category takes the rest: 146 − 26 − 54.
  expect(tableLayout(146, false, false, { description: 54, category: 35 })).toMatchObject({ description: 54, category: 66, tags: 0 })
})
