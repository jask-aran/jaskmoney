import { type SectionId } from "../../state/uiStore"
import { theme } from "../../theme"
import { AccountsPane } from "./AccountsPane"
import { createAcceptModals, createAccountModal, createRuleModal } from "./ManagerModals"
import { createManagerFilter, createManagerIndicator, createManagerPreviews, createManagerRows, createMerchantRows } from "./managerModel"
import { createManagerTables } from "./ManagerTables"
import { TransactionDetail } from "./TransactionDetail"

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
