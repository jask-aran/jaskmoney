import { merchantKey } from "../../domain/history"
import { data } from "../../state/dataStore"
import { ui } from "../../state/uiStore"
import { regionRef } from "../regions"
import { MerchantTable } from "./MerchantTable"
import { TransactionTable } from "./TransactionTable"
import { TransactionsPane } from "./TransactionsPane"
import { createManagerFilter, createManagerIndicator, createManagerPreviews, createManagerRows, createMerchantRows } from "./managerModel"

export function createManagerTables(input: Pick<ReturnType<typeof createMerchantRows>, "merchants" | "txFocused" | "groups" | "tableRows" | "sortMark"> & Pick<ReturnType<typeof createManagerFilter>, "filterBar"> & Pick<ReturnType<typeof createManagerRows>, "dims" | "measureTables" | "rowsReveal" | "showAccount" | "highlighted"> & Pick<ReturnType<typeof createManagerIndicator>, "scrollIndicator"> & Pick<ReturnType<typeof createManagerPreviews>, "tagCandidate">) {
  const { merchants, filterBar, txFocused, dims, scrollIndicator, measureTables, groups, tableRows, rowsReveal, showAccount, highlighted, sortMark, tagCandidate } = input
  const Tables = () => (
    <>
      <box ref={regionRef("mgr.transactions", "manager")} width="100%" flexGrow={1}>
      <TransactionsPane
        title={`Transactions${data.state.tagReview ? ` · tagging ${data.state.tagReview.name}` : data.state.uncategorisedOnly ? " · uncategorised" : ""}${merchants() ? " · by merchant" : ""}`}
        filter={filterBar()}
        focused={txFocused()}
        width={dims().width}
        flexGrow={1}
        bottom={scrollIndicator()}
      >
        {/* Sized by the space it's given (flexBasis 0), never by its rows: a
            table drawing the rows it was told to would hold its box at that size. */}
        <box ref={measureTables} flexGrow={1} flexBasis={0} overflow="hidden" width="100%" flexDirection="column">
        <box visible={merchants()} flexGrow={1} width="100%" flexDirection="column">
          <MerchantTable
            groups={groups()}
            top={ui.state.merchantTop}
            visible={ui.state.managerVisible}
            cursor={txFocused() && ui.state.filterBar == null ? ui.state.merchantCursor : null}
            width={dims().width - 4}
            sort={ui.state.merchantSort}
            reverse={ui.state.merchantReverse}
            empty={data.state.filterQuery ? "No matches" : "Empty · no transactions loaded"}
            // Hidden, no notes: each reads the whole-history note prompts.
            note={merchants() ? merchantNote : noNote}
          />
        </box>
        <box visible={!merchants()} flexGrow={1} width="100%" flexDirection="column">
        <TransactionTable
          rows={tableRows()}
          top={ui.state.managerTop}
          visible={ui.state.managerVisible}
          reveal={rowsReveal()}
          cursor={txFocused() && ui.state.filterBar == null ? ui.state.managerCursor : null}
          width={dims().width - 4}
          showAccount={showAccount()}
          showTags
          selectedIds={ui.state.selectedIds}
          highlighted={highlighted()}
          sortMark={sortMark}
          empty={data.state.tagReview ? (data.state.tagReview.asking ? "Asking Jev…" : "Nothing more to tag") : data.state.uncategorisedOnly ? "Nothing to categorise" : data.state.filterQuery ? "No matches" : "Empty · no transactions loaded"}
          suggestions={data.state.uncategorisedOnly ? data.state.suggestions : undefined}
          askScore={data.nearMissesShown() ? data.askScore : undefined}
          nearMiss={(id) => data.nearMissIds().has(id)}
          tagCandidate={data.state.tagReview ? tagCandidate : undefined}
        />
        </box>
        </box>
      </TransactionsPane>
      </box>
    </>
  )
  return { Tables }
}

/** A merchant's note for the table, or a prompt for one where it would
 * help (domain/suggest notePrompts): "always Groceries? n", "varies? n". */
const noNote = () => null

function merchantNote(merchant: string): { text: string; prompt: boolean } | null {
  const key = merchantKey(merchant)
  const note = data.state.merchantNotes[key]
  if (note) return { text: note, prompt: false }
  const prompt = data.notePrompts().get(key)
  if (!prompt) return null
  if (prompt.kind === "varies") return { text: "varies? n", prompt: true }
  return { text: `always ${data.state.categories.find((c) => c.id === prompt.categoryId)?.name ?? "one"}? n`, prompt: true }
}
