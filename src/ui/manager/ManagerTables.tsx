import { merchantKey } from "../../domain/history"
import { data } from "../../state/dataStore"
import { ui, type SectionId } from "../../state/uiStore"
import { theme } from "../../theme"
import { AccountsPane } from "./AccountsPane"
import { createAcceptModals, createAccountModal, createRuleModal } from "./ManagerModals"
import { TransactionDetail } from "./TransactionDetail"
import { regionRef } from "../regions"
import { MerchantTable } from "./MerchantTable"
import { TransactionTable } from "./TransactionTable"
import { TransactionsPane } from "./TransactionsPane"
import { createManagerFilter, createManagerIndicator, createManagerPreviews, createManagerRows, createMerchantRows } from "./managerModel"

function createManagerTables(input: Pick<ReturnType<typeof createMerchantRows>, "merchants" | "txFocused" | "groups" | "tableRows" | "sortMark"> & Pick<ReturnType<typeof createManagerFilter>, "filterBar"> & Pick<ReturnType<typeof createManagerRows>, "dims" | "measureTables" | "rowsReveal" | "showAccount" | "highlighted"> & Pick<ReturnType<typeof createManagerIndicator>, "scrollIndicator"> & Pick<ReturnType<typeof createManagerPreviews>, "tagCandidate">) {
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

export function ManagerTab(props: { focused: SectionId }) {
  const { rows, dims, measureTables, rowsReveal, showAccount, highlighted } = createManagerRows()
  const { merchants, groups, selCount, txFocused, tableRows, sortMark, acctFocused } = createMerchantRows({ rows, props })
  const { scrollIndicator } = createManagerIndicator({ rows, merchants, groups, selCount })
  const { filterBar } = createManagerFilter()
  const { tagCandidate, tagPreview, ACCEPT_LINES, acceptGroups, ruleOffers, ruleTop, RULE_LINES, accountAction } = createManagerPreviews()
  const { Tables } = createManagerTables({ merchants, filterBar, txFocused, dims, scrollIndicator, measureTables, groups, tableRows, rowsReveal, showAccount, highlighted, sortMark, tagCandidate })
  const { AcceptModals } = createAcceptModals({ tagPreview, ACCEPT_LINES, acceptGroups })
  const { RuleModal } = createRuleModal({ ruleOffers, ruleTop, RULE_LINES })
  const { AccountModal } = createAccountModal({ accountAction })
  return (
    <box width="100%" height="100%" flexDirection="column" backgroundColor={theme.canvas}>
      <AccountsPane focused={acctFocused()} width={dims().width} />
      <Tables />
      <TransactionDetail />
      <AcceptModals />
      <RuleModal />
      <AccountModal />
    </box>
  )
}
