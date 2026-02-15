package main

// ---------------------------------------------------------------------------
// Shared dispatch table: single source of truth for overlay/modal priority
// ---------------------------------------------------------------------------
//
// Three consumers read this table:
//   - Update (update.go)    — finds the active handler for a tea.KeyMsg
//   - footerBindings (app.go)  — finds the active scope for footer hints
//   - commandContextScope (commands.go) — finds the active scope for command availability
//
// Adding a new overlay/modal: add one entry in the correct priority position.
// All three consumers automatically stay in sync.

import tea "github.com/charmbracelet/bubbletea"

// overlayEntry defines one level in the overlay precedence chain.
// Guard returns true when this overlay is active.
// Scope is the keybinding scope for this overlay.
// Handler dispatches tea.KeyMsg to the overlay's update function.
// ForFooter indicates whether footerBindings should use this entry.
// ForCommandScope indicates whether commandContextScope should use this entry.
// (commandOpen is checked by Update and footerBindings but NOT by commandContextScope,
// because commandContextScope is only called after the commandOpen check has failed.)
type overlayEntry struct {
	name            string
	guard           func(m model) bool
	scope           func(m model) string // returns scope; most entries return a constant
	handler         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd)
	forFooter       bool
	forCommandScope bool
}

// overlayPrecedence returns the authoritative overlay priority table, ordered
// highest to lowest. The first matching guard wins. This is a function (not a
// package var) to avoid Go initialization cycles, since some handler closures
// transitively reference functions that call back into this table.
func overlayPrecedence() []overlayEntry {
	return []overlayEntry{
		{
			name:            "jump",
			guard:           func(m model) bool { return m.jumpModeActive },
			scope:           func(m model) string { return scopeJumpOverlay },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateJumpOverlay(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:  "command",
			guard: func(m model) bool { return m.commandOpen },
			scope: func(m model) string {
				if m.commandUIKind == commandUIKindPalette {
					return scopeCommandPalette
				}
				return scopeCommandMode
			},
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateCommandUI(msg) },
			forFooter:       true,
			forCommandScope: false, // unreachable from executeBoundCommand
		},
		{
			name:            "detail",
			guard:           func(m model) bool { return m.showDetail },
			scope:           func(m model) string { return scopeDetailModal },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateDetail(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "importDupe",
			guard:           func(m model) bool { return m.importDupeModal },
			scope:           func(m model) string { return scopeDupeModal },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateDupeModal(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "filePicker",
			guard:           func(m model) bool { return m.importPicking },
			scope:           func(m model) string { return scopeFilePicker },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateFilePicker(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "catPicker",
			guard:           func(m model) bool { return m.catPicker != nil },
			scope:           func(m model) string { return scopeCategoryPicker },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateCatPicker(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "tagPicker",
			guard:           func(m model) bool { return m.tagPicker != nil },
			scope:           func(m model) string { return scopeTagPicker },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateTagPicker(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "filterApplyPicker",
			guard:           func(m model) bool { return m.filterApplyPicker != nil },
			scope:           func(m model) string { return scopeFilterApplyPicker },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateFilterApplyPicker(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "managerActionPicker",
			guard:           func(m model) bool { return m.managerActionPicker != nil },
			scope:           func(m model) string { return scopeManagerAccountAction },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateManagerActionPicker(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "filterEdit",
			guard:           func(m model) bool { return m.filterEditOpen },
			scope:           func(m model) string { return scopeFilterEdit },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateFilterEdit(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "managerModal",
			guard:           func(m model) bool { return m.managerModalOpen },
			scope:           func(m model) string { return scopeManagerModal },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateManagerModal(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "dryRun",
			guard:           func(m model) bool { return m.dryRunOpen },
			scope:           func(m model) string { return scopeDryRunModal },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateDryRunModal(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "ruleEditor",
			guard:           func(m model) bool { return m.ruleEditorOpen },
			scope:           func(m model) string { return scopeRuleEditor },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateRuleEditor(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
		{
			name:            "filterInput",
			guard:           func(m model) bool { return m.filterInputMode },
			scope:           func(m model) string { return scopeFilterInput },
			handler:         func(m model, msg tea.KeyMsg) (tea.Model, tea.Cmd) { return m.updateFilterInput(msg) },
			forFooter:       true,
			forCommandScope: true,
		},
	}
}

// dispatchOverlayKey finds the first matching overlay and dispatches the key.
// Returns (model, cmd, true) if an overlay handled it, or (model, nil, false)
// if no overlay matched and the caller should continue with tab-level dispatch.
func (m model) dispatchOverlayKey(msg tea.KeyMsg) (tea.Model, tea.Cmd, bool) {
	for _, entry := range overlayPrecedence() {
		if entry.guard(m) {
			result, cmd := entry.handler(m, msg)
			return result, cmd, true
		}
	}
	return m, nil, false
}

// activeOverlayScope returns the scope of the highest-priority active overlay,
// or "" if no overlay is active.
// Pass forFooter=true from footerBindings, forFooter=false from commandContextScope.
func (m model) activeOverlayScope(forFooter bool) string {
	for _, entry := range overlayPrecedence() {
		if forFooter && !entry.forFooter {
			continue
		}
		if !forFooter && !entry.forCommandScope {
			continue
		}
		if entry.guard(m) {
			return entry.scope(m)
		}
	}
	return ""
}

// ---------------------------------------------------------------------------
// Modal text input contract
// ---------------------------------------------------------------------------
// Declares how each modal scope handles text input. This contract is the
// single source of truth for text input behavior, replacing the manual
// isTextInputModalScope() function in update.go with a data-driven approach.
//
// When adding a new modal with text fields, add an entry here. Tests verify
// that every modal scope with cursorAware=true uses the cursor-aware helpers
// and that vimNavSuppressed scopes don't bind h/j/k/l as navigation.

// modalTextBehavior declares how a modal handles text input fields.
type modalTextBehavior struct {
	cursorAware      bool // true = use insertPrintableASCIIAtCursor; false = appendPrintableASCII
	printableFirst   bool // true = printable keys are literal text, not shortcuts
	vimNavSuppressed bool // true = h/j/k/l suppressed as navigation in this scope
}

// modalTextContracts maps modal scopes to their text input behavior.
// Every modal scope that contains text-editable fields must have an entry.
var modalTextContracts = map[string]modalTextBehavior{
	scopeRuleEditor:           {cursorAware: true, printableFirst: true, vimNavSuppressed: true},
	scopeFilterEdit:           {cursorAware: true, printableFirst: true, vimNavSuppressed: true},
	scopeSettingsModeCat:      {cursorAware: true, printableFirst: true, vimNavSuppressed: true},
	scopeSettingsModeTag:      {cursorAware: true, printableFirst: true, vimNavSuppressed: true},
	scopeManagerModal:         {cursorAware: true, printableFirst: true, vimNavSuppressed: true},
	scopeDetailModal:          {cursorAware: true, printableFirst: true, vimNavSuppressed: false}, // detail modal uses dedicated updateDetailNotes handler when editing; j/k needed for non-editing scroll
	scopeFilterInput:          {cursorAware: true, printableFirst: true, vimNavSuppressed: false},
	scopeDashboardCustomInput: {cursorAware: false, printableFirst: true, vimNavSuppressed: false},
}

// isTextInputModalScope returns true if the given scope has text-editable fields
// that require vim-nav suppression (h/j/k/l must not be interpreted as navigation).
// This replaces the manual switch in update.go with a data-driven lookup.
func isTextInputModalScopeFromContract(scope string) bool {
	if b, ok := modalTextContracts[scope]; ok {
		return b.vimNavSuppressed
	}
	return false
}

// scopeHasTextContract returns true if the given scope has a registered
// text input contract. Used by tests to verify completeness.
func scopeHasTextContract(scope string) bool {
	_, ok := modalTextContracts[scope]
	return ok
}

// ---------------------------------------------------------------------------
// Reusable form helpers
// ---------------------------------------------------------------------------
// Lightweight helpers for modal forms and text fields. These don't replace
// context-specific logic but provide consistent building blocks that new
// modals and editors should compose from.

// textField bundles a string value with its cursor position. Use this for
// any text input field that needs cursor-aware editing.
type textField struct {
	Value  string
	Cursor int
}

// handleKey processes a single key event for a text field. Returns true if
// the key was consumed (printable input, backspace, or cursor movement).
func (f *textField) handleKey(keyName string, rawKey string) bool {
	switch keyName {
	case "backspace":
		deleteASCIIByteBeforeCursor(&f.Value, &f.Cursor)
		return true
	case "left":
		moveInputCursorASCII(f.Value, &f.Cursor, -1)
		return true
	case "right":
		moveInputCursorASCII(f.Value, &f.Cursor, 1)
		return true
	default:
		return insertPrintableASCIIAtCursor(&f.Value, &f.Cursor, rawKey)
	}
}

// render returns the text with a cursor marker at the current position.
func (f *textField) render() string {
	return renderASCIIInputCursor(f.Value, f.Cursor)
}

// set replaces the value and places the cursor at the end.
func (f *textField) set(value string) {
	f.Value = value
	f.Cursor = len(value)
}

// modalFormNav provides shared focus-cycling for modal forms with a fixed
// number of fields. It handles up/down/tab/shift-tab navigation.
type modalFormNav struct {
	FieldCount int
	FocusIdx   int
}

// handleNav processes a navigation key for a modal form. Returns true if
// focus changed. Callers should use this in their key dispatch after checking
// for field-specific actions (text input, pickers, toggles).
func (n *modalFormNav) handleNav(scope string, msg tea.KeyMsg, m model) bool {
	keyName := normalizeKeyName(msg.String())
	delta := m.verticalDelta(scope, msg)
	if delta != 0 {
		if delta > 0 {
			n.FocusIdx = (n.FocusIdx + 1) % n.FieldCount
		} else {
			n.FocusIdx = (n.FocusIdx - 1 + n.FieldCount) % n.FieldCount
		}
		return true
	}
	switch keyName {
	case "tab":
		n.FocusIdx = (n.FocusIdx + 1) % n.FieldCount
		return true
	case "shift+tab":
		n.FocusIdx = (n.FocusIdx - 1 + n.FieldCount) % n.FieldCount
		return true
	}
	return false
}

// ---------------------------------------------------------------------------
// Secondary tier: tab-level scope resolution
// ---------------------------------------------------------------------------
// Tab sub-state routing remains in each consumer because it's genuinely
// tab-specific. These helpers centralize the common tab-scope patterns.

// tabScope resolves the active scope for tab-level dispatch (no overlay active).
// Used by footerBindings and commandContextScope for the non-overlay fallthrough.
func (m model) tabScope() string {
	switch m.activeTab {
	case tabDashboard:
		if m.dashCustomEditing {
			return scopeDashboardCustomInput
		}
		if m.dashTimeframeFocus {
			return scopeDashboardTimeframe
		}
		if m.focusedSection >= 0 {
			return scopeDashboardFocused
		}
		return scopeDashboard
	case tabManager:
		if m.managerMode == managerModeAccounts {
			return scopeManager
		}
		return scopeTransactions
	case tabSettings:
		return m.settingsTabScope()
	default:
		return scopeDashboard
	}
}

// settingsTabScope resolves the active scope within the settings tab.
func (m model) settingsTabScope() string {
	// Note: ruleEditorOpen and dryRunOpen are already handled by the overlay
	// table. They should not be active when this function is called. We include
	// these checks defensively for robustness but they should be dead code in
	// normal operation.
	if m.ruleEditorOpen {
		return scopeRuleEditor
	}
	if m.dryRunOpen {
		return scopeDryRunModal
	}
	if m.settMode != settModeNone {
		switch m.settMode {
		case settModeAddCat, settModeEditCat:
			return scopeSettingsModeCat
		case settModeAddTag, settModeEditTag:
			return scopeSettingsModeTag
		}
	}
	if m.confirmAction != confirmActionNone {
		if spec, ok := settingsConfirmSpecFor(m.confirmAction); ok {
			return spec.scope
		}
	}
	if m.settActive {
		return settingsActiveScope(m.settSection)
	}
	return scopeSettingsNav
}
