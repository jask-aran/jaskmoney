import { expect, test } from "bun:test"
import { tableLayout } from "./TransactionTable"

// Fixed columns with tags and no account: marker 1, date 9, amount 13 and
// four gaps leave `width - 27` for description, category and tags.
test("the description gets its longest text up to 36, then the category, then tags the rest", () => {
  expect(tableLayout(146, false, true, { description: 30, category: 35 })).toMatchObject({ description: 30, category: 35, tags: 54 })
  expect(tableLayout(146, false, true, { description: 54, category: 35 })).toMatchObject({ description: 36, category: 35, tags: 48 })
})

test("when space is short, tags keep 8 and category 16 before the description gives way", () => {
  // 106 − 27 = 79: description 36, category 35, tags 8.
  expect(tableLayout(106, false, true, { description: 54, category: 35 })).toMatchObject({ description: 36, category: 35, tags: 8 })
  // 100 − 27 = 73: the category gets 29 of its 35 above tags' 8.
  expect(tableLayout(100, false, true, { description: 54, category: 35 })).toMatchObject({ description: 36, category: 29, tags: 8 })
  // 70 − 27 = 43: the description gives way to category 16 and tags 8.
  expect(tableLayout(70, false, true, { description: 54, category: 35 })).toMatchObject({ description: 19, category: 16, tags: 8 })
  // Without tags (and their gap) the category takes the rest: 146 − 26 − 36.
  expect(tableLayout(146, false, false, { description: 54, category: 35 })).toMatchObject({ description: 36, category: 84, tags: 0 })
})
