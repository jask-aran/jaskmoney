# Phase 0: Greenfield Framework Architecture

**Goal:** Build idiomatic, low-LOC UI framework that doesn't fight Bubble Tea/Bubbles.

**Strategy:** Extract proven architectural contracts from current app into clean primitives.

**Target:** ~4,200 LOC fully-functional UI skeleton + minimal data layer.

---

## Core Architectural Contracts

Phase 0 defines **5 high-dimensional contract shapes** that govern how the entire app works:

### 1. **Key Dispatch Contract** 🔴 CRITICAL

**Problem in current app:**
- Table-driven `overlayPrecedence()` scanned on every keypress
- `modalTextContracts` table for text input safety
- Complex precedence resolution with special cases

**Phase 0 Contract:**
```
┌─────────────────────────────────────────┐
│ Key Event (tea.KeyMsg)                  │
└────────────┬────────────────────────────┘
             │
             ↓
     ┌───────────────┐      YES    ┌──────────────────┐
     │ Screen stack  ├─────────────→│ Top screen       │
     │ has screens?  │              │ handles key      │
     └───────┬───────┘              └──────────────────┘
             │ NO
             ↓
     ┌───────────────┐              ┌──────────────────┐
     │ Active tab    ├─────────────→│ Tab handles key  │
     │ handles key   │              │                  │
     └───────────────┘              └──────────────────┘
```

**Implementation:**
```go
// core/router.go
func (m Model) Update(msg tea.Msg) (Model, tea.Cmd) {
    switch msg := msg.(type) {
    case tea.KeyMsg:
        // Contract: Top screen wins, else tab handles
        if top := m.screens.Top(); top != nil {
            return m.updateScreen(top, msg)
        }
        return m.updateTab(msg)
    }
}
```

**Key insight:** No precedence table. Stack order = priority.

**Context awareness:**
- Screens declare `Scope()` for keybinding resolution
- Tabs declare `Scope()` for keybinding resolution
- KeyRegistry filters bindings by active scope
- Footer auto-renders bindings for active scope

**Contract guarantees:**
- ✅ Top of stack always handles keys first
- ✅ Bubbles inputs consume keys (no manual contracts)
- ✅ Footer always shows correct bindings for context
- ✅ No special cases, no precedence tables

---

### 2. **Screen Lifecycle Contract** 🔴 CRITICAL

**Problem in current app:**
- Modals tracked by boolean flags in model
- State scattered across 60+ modal-specific fields
- No clear open/close lifecycle

**Phase 0 Contract:**
```
Screen Lifecycle States:
  Created → Pushed → Top → [Updated] → Popped → Destroyed

  Created:    Screen instantiated, holds initial state
  Pushed:     Added to stack, may not be visible yet (if another pushed on top)
  Top:        Visible and receiving key events
  Updated:    Handling messages, can return (self, cmd, pop=true) to close
  Popped:     Removed from stack, state discarded
```

**Implementation:**
```go
// core/router.go
type Screen interface {
    // Update returns (new screen state, cmd, should pop?)
    Update(msg tea.Msg) (Screen, tea.Cmd, bool)

    // View renders when this screen is top of stack
    View(width, height int) string

    // Scope for keybinding resolution
    Scope() string
}

// Model holds the stack
type Model struct {
    screens ScreenStack
}

// Pushing a screen
m.screens.Push(NewPickerScreen(...))

// Screen can close itself
func (s *PickerScreen) Update(msg tea.Msg) (Screen, tea.Cmd, bool) {
    if msg.Key == "esc" {
        return s, nil, true  // pop=true closes screen
    }
    return s, nil, false
}
```

**Contract guarantees:**
- ✅ Screens own their state (not in global model)
- ✅ Screens can close themselves (return pop=true)
- ✅ Screens can be nested (push screen from screen)
- ✅ Clear lifecycle, no boolean flags

---

### 3. **Widget Composition Contract** 🔴 CRITICAL

**Problem in current app:**
- 50+ render functions with manual layout math
- Duplication of box styles, padding, alignment
- No reusable composition

**Phase 0 Contract:**
```
Widget Tree → Layout Engine → Rendered String

Widgets declare WHAT to show, not HOW to position.
Layout engine arranges widgets based on available space.

Example:
  VStack [
    HStack [ Box("Summary"), Box("Accounts") ],  ← Horizontal layout
    Chart("Spending"),                           ← Full width
    Table(rows),                                 ← Full width
  ]                                              ← Vertical layout
```

**Implementation:**
```go
// widgets/widget.go
type Widget interface {
    // Render with given space allocation
    Render(width, height int) string
}

// Composition widgets
type VStack struct {
    Widgets []Widget
    Spacing int
}

type HStack struct {
    Widgets []Widget
    Ratios  []float64  // Optional: [0.6, 0.4] = 60%/40% split
}

// Layout engine
func (v VStack) Render(width, height int) string {
    // Divide height among children
    // Call each child's Render()
    // Join with newlines + spacing
}
```

**Contract guarantees:**
- ✅ Widgets are composable (VStack of HStacks of Boxes)
- ✅ Widgets are pure (same inputs = same output)
- ✅ Layout is declarative (no manual positioning)
- ✅ Responsive (layout reflows on window resize)

**Concrete example (Dashboard tab):**
```go
func (t *DashboardTab) BuildWidgets(m Model) Widget {
    return VStack{
        Widgets: []Widget{
            HStack{
                Widgets: []Widget{
                    Box{Title: "Summary", Content: "TODO"},
                    Box{Title: "Accounts", Content: "TODO"},
                },
                Ratios: []float64{0.5, 0.5},
            },
            Chart{Title: "Spending Tracker", Data: nil},
            Table{Headers: []string{"Category", "Amount"}, Rows: nil},
        },
        Spacing: 1,
    }
}
```

---

### 4. **Command Scope Contract** 🟡 HIGH PRIORITY

**Problem in current app:**
- Commands work, but scope filtering is complex
- Disabled-reason logic scattered
- Command palette reimplements filtering

**Phase 0 Contract:**
```
Command declares:
  - ID (stable identifier)
  - Scopes (where it's available)
  - Disabled() check (context-dependent availability)
  - Execute() action

Command Palette queries:
  - CommandRegistry.Search(query, activeScope)
  - Returns only commands valid in current scope
  - Filters by query string
  - Shows disabled commands with reason
```

**Implementation:**
```go
// core/commands.go
type Command struct {
    ID          string
    Name        string
    Description string
    Scopes      []string
    Execute     func(m Model) (Model, tea.Cmd)
    Disabled    func(m Model) (bool, string)  // (disabled, reason)
}

// Scope-aware search
func (r *CommandRegistry) Search(query string, scope string) []Command {
    // Filter by scope first
    // Then filter by query match (fuzzy or prefix)
    // Return sorted by relevance
}
```

**Contract guarantees:**
- ✅ Commands declare where they're valid
- ✅ Palette only shows relevant commands
- ✅ Disabled commands show reason
- ✅ No global command execution (always scoped)

---

### 5. **Message Routing Contract** 🟡 HIGH PRIORITY

**Problem in current app:**
- Implicit message routing (who handles what?)
- Async results scattered across files
- No standard message types

**Phase 0 Contract:**
```
Message Flow:
  1. tea.WindowSizeMsg    → Model (updates width/height)
  2. tea.KeyMsg           → Screen stack top OR active tab
  3. Custom async msg     → Whoever issued the Cmd handles result

Standard messages:
  - WindowSizeMsg: Always handled by Model
  - KeyMsg: Routed by key dispatch contract
  - StatusMsg: Sets status bar
  - DataLoadedMsg: Generic async result wrapper
```

**Implementation:**
```go
// core/messages.go
type StatusMsg struct {
    Text  string
    IsErr bool
}

type DataLoadedMsg struct {
    Key  string      // Identifies what was loaded
    Data interface{}
    Err  error
}

// In Update()
func (m Model) Update(msg tea.Msg) (Model, tea.Cmd) {
    switch msg := msg.(type) {
    case tea.WindowSizeMsg:
        m.width, m.height = msg.Width, msg.Height
        return m, nil
    case StatusMsg:
        m.status = msg.Text
        m.statusErr = msg.IsErr
        return m, nil
    case DataLoadedMsg:
        // Route to whoever cares about msg.Key
    case tea.KeyMsg:
        // Route via key dispatch contract
    }
}
```

**Contract guarantees:**
- ✅ Explicit message types
- ✅ Clear routing rules
- ✅ Standard async pattern (issue Cmd, handle result msg)

---

## Data Primitives (Minimal Schema)

**Why needed:** Phase 0 must be runnable with real data shapes.

**What's included:**

### Schema (`db/schema.go`)
```go
// Core tables (minimal v2 schema)
CREATE TABLE accounts (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,      -- checking, savings, credit
    prefix TEXT,              -- ANZ, WBC (for import detection)
    active INTEGER DEFAULT 1
);

CREATE TABLE transactions (
    id INTEGER PRIMARY KEY,
    account_id INTEGER NOT NULL,
    date_iso TEXT NOT NULL,   -- YYYY-MM-DD
    amount REAL NOT NULL,     -- negative = debit, positive = credit
    description TEXT NOT NULL,
    category_id INTEGER,      -- NULL = uncategorized
    notes TEXT,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
);

CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL       -- hex color for UI
);

CREATE TABLE tags (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    scope_id INTEGER          -- category ID or NULL (global)
);

CREATE TABLE transaction_tags (
    transaction_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (transaction_id, tag_id)
);
```

### Basic Queries (`db/queries.go`)
```go
// Read operations only (no business logic)
func GetTransactions(db *sql.DB) ([]Transaction, error)
func GetTransactionsByAccount(db *sql.DB, accountID int) ([]Transaction, error)
func GetAccounts(db *sql.DB) ([]Account, error)
func GetCategories(db *sql.DB) ([]Category, error)
func GetTags(db *sql.DB) ([]Tag, error)
```

**NOT included in Phase 0:**
- ❌ Filter engine (ports in Phase 1-N)
- ❌ Budget calculations (ports in Phase 1-N)
- ❌ Import logic (ports in Phase 1-N)
- ❌ Rule application (ports in Phase 1-N)

### Seed Data (`db/seed.go`)
```go
// Generate fake transactions for testing
func SeedTestData(db *sql.DB) error {
    // 3 accounts (checking, savings, credit)
    // 10 categories (groceries, transport, dining, etc.)
    // 5 tags (urgent, recurring, work, personal, tax-deductible)
    // 100 transactions (spread over 90 days)
}
```

**Contract:** All Phase 0 widgets/screens use this minimal schema. Port in Phase 1-N adds business logic.

---

## Additional Architectural Patterns

### 6. **Keybinding Registry** (Context-Aware)

**Current app:** `KeyRegistry` exists, works well.

**Phase 0:** Extract and clean up.

```go
// core/keys.go
type KeyBinding struct {
    Keys        []string  // "ctrl+s", "enter", etc.
    Action      string    // "save", "select", etc.
    Description string
    Scopes      []string  // Where active
}

type KeyRegistry struct {
    bindings []KeyBinding
}

// Context-aware queries
func (r *KeyRegistry) IsAction(msg tea.KeyMsg, action, scope string) bool
func (r *KeyRegistry) BindingsForScope(scope string) []KeyBinding
```

**Contract:** Tabs/screens declare actions they handle, KeyRegistry maps keys → actions in scope.

---

### 7. **Footer Contract** (Auto-Generated Help)

**Current app:** Manual footer rendering with special cases.

**Phase 0:** Footer auto-generates from active scope.

```go
// core/footer.go
func RenderFooter(m Model) string {
    scope := m.ActiveScope()  // From screen top or tab
    bindings := m.keys.BindingsForScope(scope)
    return formatBindings(bindings, m.width)
}
```

**Contract:** Footer always shows correct bindings. No manual updates needed.

---

### 8. **Status Bar Contract** (Centralized Feedback)

**Current app:** `status` + `statusErr` in model, works.

**Phase 0:** Keep it, make it explicit.

```go
// Model
type Model struct {
    status    string
    statusErr bool
}

// Helpers
func (m Model) SetStatus(msg string) Model { ... }
func (m Model) SetError(err error) Model { ... }

// Rendering
func RenderStatusBar(m Model) string { ... }
```

**Contract:** All errors/success messages go through status bar.

---

## High-Dimensional Contract Shapes Summary

| Contract | Current App | Phase 0 | Impact |
|----------|-------------|---------|--------|
| **Key Dispatch** | `overlayPrecedence()` table | Screen stack top wins | Delete 250 LOC precedence logic |
| **Screen Lifecycle** | Boolean flags + 60 fields | Screen interface + stack | Delete modal field clusters |
| **Widget Composition** | 50+ render functions | Widget tree + layout engine | Delete 2,500 LOC duplication |
| **Command Scope** | Works, needs cleanup | Clean CommandRegistry | Simplify command system |
| **Message Routing** | Implicit | Explicit message types | Clarify async patterns |

---

## Phase 0 File Structure

```
greenfield/                     (this folder - already exists)
├── phase-0.md                  (this doc)
├── phase-1-N.md                (port strategy)
│
├── main.go                     (50 LOC)   - ⚠️ NEW: v2 entry point
├── go.mod                      (generated) - ⚠️ NEW: v2 module
├── go.sum                      (generated)
│
├── core/
│   ├── app.go                  (300 LOC)  - Model + Init/Update/View orchestration
│   ├── router.go               (150 LOC)  - Screen stack (lifecycle contract)
│   ├── keys.go                 (400 LOC)  - KeyRegistry (context-aware)
│   ├── commands.go             (400 LOC)  - CommandRegistry (scope contract)
│   ├── footer.go               (150 LOC)  - Auto-generated footer
│   ├── messages.go             (100 LOC)  - Standard message types
│   ├── jump.go                 (150 LOC)  - Jump mode
│   ├── theme.go                (100 LOC)  - Colors (copied from ../theme.go)
│   └── styles.go               (200 LOC)  - Standard lipgloss styles
│
├── tabs/
│   ├── tab.go                  (50 LOC)   - Tab interface
│   ├── dashboard.go            (150 LOC)
│   ├── manager.go              (150 LOC)
│   ├── budget.go               (150 LOC)
│   └── settings.go             (150 LOC)
│
├── screens/
│   ├── picker.go               (200 LOC)  - Generic picker (Bubbles list)
│   ├── command.go              (150 LOC)  - Command palette
│   └── editor.go               (150 LOC)  - Generic form editor
│
├── widgets/
│   ├── widget.go               (100 LOC)  - Widget interface
│   ├── layout.go               (150 LOC)  - VStack, HStack, layout helpers
│   ├── modal.go                (100 LOC)  - Modal compositor
│   ├── box.go                  (50 LOC)
│   ├── list.go                 (100 LOC)
│   ├── table.go                (100 LOC)
│   └── chart.go                (100 LOC)
│
└── db/                         (⚠️ NEW: Data primitives)
    ├── schema.go               (400 LOC)  - Tables + migrations
    ├── queries.go              (600 LOC)  - Basic CRUD operations
    └── seed.go                 (200 LOC)  - Mock data for testing

**Total: ~4,200 LOC**
```

**Note:** The v2 app is entirely self-contained in `greenfield/`. The v1 app (parent directory) is never touched.

---

## Phase 0 Validation

**After building Phase 0:**

```bash
cd greenfield
go run .
```

**Expected behavior:**

**Data Layer:**
- ✅ DB initializes with schema
- ✅ Seeds with 100 fake transactions
- ✅ 3 accounts, 10 categories, 5 tags loaded

**UI Layer:**
- ✅ 4 tabs render with real data
- ✅ Dashboard shows transaction chart (with fake data)
- ✅ Manager shows transaction table (with fake data)
- ✅ Tab switching works (`1-4` keys)
- ✅ Jump mode works (`j`, letter keys)
- ✅ Command palette works (`ctrl+k`)
- ✅ Footer shows active keybindings (auto-generated from scope)
- ✅ Status bar shows "Ready" message
- ✅ Can push category picker screen (shows real categories)
- ✅ Can pop screen with `esc`
- ✅ Window resize reflows widget layout

**All architectural contracts validated with real data shapes flowing through.**

---

## Key Questions

### 1. Are there other high-dimensional contract shapes we need?

**Candidates:**
- **Tab lifecycle contract?** (visibility, focus, drill-return state)
- **Widget size negotiation?** (widgets request size, layout allocates)
- **Async operation contract?** (loading states, cancellation)
- **Data dependency contract?** (who loads what, when)

**Or is the current set (5 contracts) sufficient for clean port?**

---

### 2. Is the keybinding layer sufficient?

**Current design:**
- KeyRegistry holds bindings (key → action, scoped)
- Screens/tabs use `keys.IsAction(msg, "save", scope)` to check
- Footer auto-generates from KeyRegistry
- Context-aware via scope filtering

**Questions:**
- Does this handle all current app keybinding needs?
- Are there edge cases (chords, mode-specific bindings, etc.)?
- Is the contract clear enough?

---

### 3. What about Bubbles component integration?

**Phase 0 screens use Bubbles:**
- `screens/picker.go` uses `bubbles/list` + `bubbles/textinput`
- `screens/command.go` uses `bubbles/list` + `bubbles/textinput`
- `screens/editor.go` uses `bubbles/textinput` for form fields

**Contract:** Screens wrap Bubbles components, handle their Update/View, and translate to app-level messages.

**Is this the right integration pattern?**

---

## Next Steps

**If this architecture is complete:**
1. Build Phase 0 (~3,000 LOC)
2. Validate all contracts work
3. Move to Phase 1-N (port features into framework)

**If architecture needs adjustments:**
- Identify missing contracts
- Revise file structure
- Clarify contract shapes
