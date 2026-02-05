# JaskMoney - Technical Specification v2.0

## Overview

**JaskMoney** is a terminal-based personal finance application built with Go and Bubbletea. It provides transaction management, automatic categorization via LLM, duplicate reconciliation, budget tracking, and spending dashboards.

### Design Philosophy

- **Terminal-native**: Designed for keyboard-first interaction, fast navigation
- **AI-assisted**: LLM handles tedious categorization; user stays in control
- **Privacy-first**: All data stored locally in SQLite; LLM calls are optional
- **Beautiful simplicity**: Clean, information-dense UI without clutter

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                            TUI Layer                                     │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐           │
│  │ Dashboard  │ │Transaction │ │  Reconcile │ │  Accounts  │           │
│  │   View     │ │   List     │ │   Queue    │ │   View     │           │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘           │
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐           │
│  │  Budget    │ │  Import    │ │  Settings  │ │   Help     │           │
│  │   View     │ │   View     │ │   View     │ │  Overlay   │           │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Service Layer                                   │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │   Ingest     │ │  Categorizer │ │  Reconciler  │ │   Budget     │   │
│  │   Service    │ │   Service    │ │   Service    │ │   Service    │   │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           LLM Layer                                      │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │  LLM Client (Gemini 2.5 Flash, swappable provider)                │  │
│  │  - Structured prompts with JSON schema                            │  │
│  │  - Confidence scoring (0.0-1.0)                                   │  │
│  │  - Async/non-blocking with message bus                            │  │
│  │  - Graceful degradation on failure                                │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           Data Layer                                     │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐   │
│  │  SQLite DB   │ │  Repository  │ │  Migration   │ │   Export     │   │
│  │              │ │   Pattern    │ │   Manager    │ │   Service    │   │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Visual Design System

### Color Palette

```
┌─────────────────────────────────────────────────────────────────────────┐
│  JASKMONEY COLOR SYSTEM                                                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Primary       #7C3AED (Purple)     ████████  Headers, focus states     │
│  Secondary     #06B6D4 (Cyan)       ████████  Links, accents            │
│  Success       #10B981 (Green)      ████████  Income, positive          │
│  Warning       #F59E0B (Amber)      ████████  Pending, caution          │
│  Danger        #EF4444 (Red)        ████████  Expense, errors           │
│  Muted         #6B7280 (Gray)       ████████  Secondary text            │
│                                                                          │
│  Background    Terminal default     Respects user's terminal theme      │
│  Surface       Subtle contrast      For cards, modals                   │
│  Border        #374151 (Dark gray)  ████████  Dividers, frames          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Typography

```
┌─────────────────────────────────────────────────────────────────────────┐
│  TYPOGRAPHY SCALE                                                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Title         Bold + Underline     "JaskMoney Dashboard"               │
│  Heading       Bold                 "Top Categories"                    │
│  Body          Regular              Transaction descriptions            │
│  Mono          Monospace            $1,234.56  (amounts, dates)         │
│  Muted         Dimmed               Secondary information               │
│  Accent        Bold + Color         Selected items, highlights          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Spacing & Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  LAYOUT GRID                                                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─ Header (2 lines) ─────────────────────────────────────────────────┐ │
│  │  App Title / Breadcrumb                              Status Area   │ │
│  │  ═══════════════════════════════════════════════════════════════   │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌─ Body (flex) ──────────────────────────────────────────────────────┐ │
│  │                                                                     │ │
│  │   Main content area - scrollable                                   │ │
│  │   Padding: 1 char horizontal, 0 vertical                           │ │
│  │                                                                     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
│  ┌─ Footer (2 lines) ─────────────────────────────────────────────────┐ │
│  │  ═══════════════════════════════════════════════════════════════   │ │
│  │  [key] Action   [key] Action   [key] Action         Status msg     │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### UI Components

#### Progress Bars
```
Full bar:    ████████████████████  100%
Partial:     ████████████░░░░░░░░   60%
Warning:     ████████████████░░░░   80%  (amber when >80%)
Over:        ████████████████████  120%  (red when >100%)
```

#### Status Indicators
```
●  Active/Selected (filled circle)
○  Inactive/Unselected (hollow circle)
◆  Flagged/Important (diamond)
▶  Current cursor position
✓  Completed/Success
✗  Error/Failed
⟳  Loading/Processing
```

#### Borders & Frames
```
┌────────────────┐     ╔════════════════╗     ┏━━━━━━━━━━━━━━━━┓
│  Light frame   │     ║  Double frame  ║     ┃  Heavy frame   ┃
└────────────────┘     ╚════════════════╝     ┗━━━━━━━━━━━━━━━━┛
```

---

## TUI Views - Complete Mockups

### 1. Dashboard (Home) - Full Layout

```
┌─ JaskMoney ─────────────────────────────────────────────────────────────┐
│                                                                          │
│  February 2026                                      Total Spend: $3,245  │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│  TOP CATEGORIES                              │  QUICK STATS              │
│  ──────────────────────────────────────────  │  ────────────────────     │
│                                              │                           │
│  Food               $892.34  ████████░░ 27% │  Transactions     47      │
│  Fixed Costs        $650.00  █████░░░░░ 20% │  Uncategorized    12      │
│  Shopping           $423.11  ████░░░░░░ 13% │  Pending Recon     3      │
│  Transport          $215.00  ██░░░░░░░░  7% │                           │
│  Entertainment      $189.22  ██░░░░░░░░  6% │  ACCOUNTS                 │
│                                              │  ────────────────────     │
│  RECENT ACTIVITY                             │  ANZ Checking    $4,521   │
│  ──────────────────────────────────────────  │  ANZ Savings    $12,350   │
│                                              │  Amex Card      -$1,245   │
│  Today                                       │                           │
│    UBER EATS* SUSHI PLACE         -$23.50   │  BUDGET STATUS            │
│    SPOTIFY                        -$10.99   │  ────────────────────     │
│                                              │  Food      ████████░░ 89% │
│  Yesterday                                   │  Shopping  ████░░░░░░ 42% │
│    AMAZON.COM*XYZ123              -$54.99   │  Entertain ██████████ 100%│
│    WOOLWORTHS 1234                -$87.32   │                           │
│                                              │                           │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [t] Transactions  [r] Reconcile (3)  [b] Budgets  [i] Import  [?] Help │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Dashboard - Loading State
```
┌─ JaskMoney ─────────────────────────────────────────────────────────────┐
│                                                                          │
│  February 2026                                                           │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│                                                                          │
│                                                                          │
│                         ⟳  Loading transactions...                       │
│                                                                          │
│                                                                          │
│                                                                          │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [t] Transactions  [r] Reconcile  [b] Budgets  [i] Import  [?] Help     │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Dashboard - Empty State
```
┌─ JaskMoney ─────────────────────────────────────────────────────────────┐
│                                                                          │
│  February 2026                                         Total Spend: $0   │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│                                                                          │
│                                                                          │
│                        No transactions yet                               │
│                                                                          │
│                   Press [i] to import a CSV file                         │
│                   or [g] to generate test data                           │
│                                                                          │
│                                                                          │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [i] Import CSV  [g] Generate Test Data  [?] Help  [q] Quit             │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Dashboard - With Budget Warnings
```
┌─ JaskMoney ─────────────────────────────────────────────────────────────┐
│                                                                          │
│  February 2026                                      Total Spend: $3,245  │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│  TOP CATEGORIES                              │  BUDGET ALERTS            │
│  ──────────────────────────────────────────  │  ────────────────────     │
│                                              │                           │
│  Food               $892.34  ████████░░ 27% │  ⚠ Entertainment          │
│  Fixed Costs        $650.00  █████░░░░░ 20% │    $200 / $200 (100%)     │
│  Shopping           $423.11  ████░░░░░░ 13% │                           │
│  Transport          $215.00  ██░░░░░░░░  7% │  ⚠ Food approaching       │
│  Entertainment      $200.00  ██░░░░░░░░  6% │    $892 / $1000 (89%)     │
│                                              │                           │
│                                              │                           │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [t] Transactions  [r] Reconcile (3)  [b] Budgets  [i] Import  [?] Help │
└──────────────────────────────────────────────────────────────────────────┘
```

---

### 2. Transaction List - Full Layout

```
┌─ Transactions ──────────────────────────────────────────────────────────┐
│  February 2026  │  Account: All  │  Category: All  │  47 transactions   │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│  DATE   DESCRIPTION                      CATEGORY           AMOUNT      │
│  ─────────────────────────────────────────────────────────────────────   │
│  02/03  UBER EATS* SUSHI PLACE           Food > Takeaway       -$23.50  │
│  02/03  SPOTIFY                          Fixed > Subs          -$10.99  │
│▶ 02/02  AMAZON.COM*XYZ123                [uncategorized]       -$54.99  │
│  02/02  TRANSFER TO SAVINGS              Savings > Transfer  -$500.00   │
│  02/01  WOOLWORTHS 1234                  Food > Groceries      -$87.32  │
│  02/01  COLES EXPRESS                    Food > Groceries      -$34.21  │
│  02/01  SALARY ACME CORP                 [income]           +$4,500.00  │
│  01/31  NETFLIX                          Fixed > Subs          -$22.99  │
│  01/31  PETROL SHELL                     Transport > Fuel      -$85.00  │
│  01/30  JB HI-FI                         Shopping > Electronics -$299.00│
│                                                                          │
│  ─────────────────────────────────────────────────────────────────────   │
│                                              Showing 1-10 of 47  ↓ more  │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [c] Categorize  [e] Edit  [t] Tags  [/] Search  [f] Filter  [d] Back   │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Transaction List - With Selection Details
```
┌─ Transactions ──────────────────────────────────────────────────────────┐
│  February 2026  │  Account: All  │  Category: All  │  47 transactions   │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│  DATE   DESCRIPTION                      CATEGORY           AMOUNT      │
│  ─────────────────────────────────────────────────────────────────────   │
│  02/03  UBER EATS* SUSHI PLACE           Food > Takeaway       -$23.50  │
│  02/03  SPOTIFY                          Fixed > Subs          -$10.99  │
│▶ 02/02  AMAZON.COM*XYZ123                [uncategorized]       -$54.99  │
│  ┌─ Transaction Details ──────────────────────────────────────────────┐  │
│  │  Date:        02/02/2026 (posted 02/03/2026)                       │  │
│  │  Description: AMAZON.COM*XYZ123                                    │  │
│  │  Amount:      -$54.99                                              │  │
│  │  Account:     ANZ Checking                                         │  │
│  │  Category:    Not set                                              │  │
│  │  Tags:        none                                                 │  │
│  │  Comment:     -                                                    │  │
│  │  Status:      Posted                                               │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [c] Categorize  [e] Edit  [t] Tags  [a] AI Suggest  [esc] Close detail │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Transaction List - Filter Panel Open
```
┌─ Transactions ──────────────────────────────────────────────────────────┐
│  February 2026  │  Account: All  │  Category: All  │  47 transactions   │
│  ═══════════════════════════════════════════════════════════════════════ │
│  ┌─ Filters ────────────────────────────────────────────────────────┐    │
│  │                                                                   │    │
│  │  Account:    [All Accounts        ▼]                             │    │
│  │  Category:   [All Categories      ▼]                             │    │
│  │  Date Range: [This Month          ▼]                             │    │
│  │  Amount:     Min [      ] Max [      ]                           │    │
│  │  Status:     [●] Posted  [●] Pending  [○] Reconciled             │    │
│  │  Search:     [                                    ]              │    │
│  │                                                                   │    │
│  │  [enter] Apply  [r] Reset  [esc] Cancel                          │    │
│  └───────────────────────────────────────────────────────────────────┘    │
│                                                                          │
│  02/03  UBER EATS* SUSHI PLACE           Food > Takeaway       -$23.50  │
│  02/03  SPOTIFY                          Fixed > Subs          -$10.99  │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [c] Categorize  [e] Edit  [t] Tags  [/] Search  [f] Filter  [d] Back   │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Transaction List - AI Categorizing
```
┌─ Transactions ──────────────────────────────────────────────────────────┐
│  February 2026  │  Account: All  │  Category: All  │  47 transactions   │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│  DATE   DESCRIPTION                      CATEGORY           AMOUNT      │
│  ─────────────────────────────────────────────────────────────────────   │
│  02/03  UBER EATS* SUSHI PLACE           Food > Takeaway       -$23.50  │
│  02/03  SPOTIFY                          Fixed > Subs          -$10.99  │
│▶ 02/02  AMAZON.COM*XYZ123                ⟳ AI analyzing...     -$54.99  │
│  02/02  TRANSFER TO SAVINGS              Savings > Transfer  -$500.00   │
│  02/01  WOOLWORTHS 1234                  Food > Groceries      -$87.32  │
│                                                                          │
│  ─────────────────────────────────────────────────────────────────────   │
│                                                                          │
│                    ⟳  Categorizing with AI... (12 remaining)            │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [c] Categorize  [e] Edit  [t] Tags  [x] Cancel AI  [d] Back            │
└──────────────────────────────────────────────────────────────────────────┘
```

---

### 3. Reconciliation Queue - Full Layout

```
┌─ Reconciliation ────────────────────────────────────────────────────────┐
│  Potential Duplicates                                    3 pending      │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│  MATCH 1 of 3                                       Confidence: 88%     │
│  ───────────────────────────────────────────────────────────────────     │
│                                                                          │
│  TRANSACTION A (older)                                                   │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Date:    01/28/2026                                               │  │
│  │  Desc:    PENDING - AMAZON PURCHASE                                │  │
│  │  Amount:  -$54.99                                                  │  │
│  │  Status:  Pending                                                  │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                    ↕ 2 days apart                        │
│  TRANSACTION B (newer) ← will be kept                                   │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │  Date:    01/30/2026                                               │  │
│  │  Desc:    AMAZON.COM*123ABC                                        │  │
│  │  Amount:  -$54.99                                                  │  │
│  │  Status:  Posted                                                   │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  AI ANALYSIS                                                             │
│  ───────────────────────────────────────────────────────────────────     │
│  "Same amount ($54.99), within 2 days, both Amazon transactions.        │
│   Likely a pending → posted transition for the same purchase."          │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [y] Merge (keep B)  [n] Not duplicate  [s] Skip  [←/→] Navigate  [d] Back│
└──────────────────────────────────────────────────────────────────────────┘
```

#### Reconciliation - Empty State
```
┌─ Reconciliation ────────────────────────────────────────────────────────┐
│  Potential Duplicates                                                    │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│                                                                          │
│                                                                          │
│                         ✓  No pending matches                            │
│                                                                          │
│                     All duplicates have been reviewed.                   │
│                                                                          │
│                     Press [s] to scan for new matches                    │
│                     or [d] to return to dashboard.                       │
│                                                                          │
│                                                                          │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [s] Scan for Duplicates  [d] Dashboard  [?] Help                       │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Reconciliation - Merge Confirmation
```
┌─ Reconciliation ────────────────────────────────────────────────────────┐
│  Potential Duplicates                                    3 pending      │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│  MATCH 1 of 3                                       Confidence: 88%     │
│                                                                          │
│  ┌─ Confirm Merge ────────────────────────────────────────────────────┐  │
│  │                                                                     │  │
│  │  Merge these transactions?                                         │  │
│  │                                                                     │  │
│  │  • Transaction B (01/30 AMAZON.COM*123ABC) will be kept           │  │
│  │  • Transaction A (01/28 PENDING - AMAZON) will be hidden          │  │
│  │  • Any tags/comments from A will be preserved on B                │  │
│  │                                                                     │  │
│  │  This action cannot be undone.                                     │  │
│  │                                                                     │  │
│  │              [y] Yes, merge    [n] Cancel                          │  │
│  │                                                                     │  │
│  └────────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [y] Merge (keep B)  [n] Not duplicate  [s] Skip  [←/→] Navigate  [d] Back│
└──────────────────────────────────────────────────────────────────────────┘
```

---

### 4. Category Picker Modal - Full Layout

```
┌─ Transactions ──────────────────────────────────────────────────────────┐
│  February 2026  │  Account: All  │  Category: All  │  47 transactions   │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│  02/03  UBER EATS* SUSHI PLACE      ┌─ Select Category ───────────────┐ │
│  02/03  SPOTIFY                     │                                  │ │
│▶ 02/02  AMAZON.COM*XYZ123           │  Search: [electronics      ]    │ │
│  02/02  TRANSFER TO SAVINGS         │  ────────────────────────────   │ │
│  02/01  WOOLWORTHS 1234             │                                  │ │
│  02/01  COLES EXPRESS               │  ▼ Shopping                      │ │
│  02/01  SALARY ACME CORP            │    ├─ Clothing                   │ │
│                                     │    ├─ Electronics     ◀ selected │ │
│                                     │    ├─ Home & Garden              │ │
│                                     │    └─ General                    │ │
│                                     │  ▶ Food                          │ │
│                                     │  ▶ Fixed Costs                   │ │
│                                     │  ▶ Investments & Savings         │ │
│                                     │  ▶ Misc                          │ │
│                                     │                                  │ │
│                                     │  ────────────────────────────   │ │
│                                     │  [enter] Select  [esc] Cancel   │ │
│                                     │  [n] New category               │ │
│                                     └──────────────────────────────────┘ │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [c] Categorize  [e] Edit  [t] Tags  [/] Search  [f] Filter  [d] Back   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

### 5. Budget View (Phase 2)

```
┌─ Budgets ───────────────────────────────────────────────────────────────┐
│  February 2026                                           18 days left   │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│  CATEGORY              BUDGET      SPENT       REMAINING    STATUS      │
│  ───────────────────────────────────────────────────────────────────     │
│                                                                          │
│  Food                  $1,000      $892        $108         ████████░░  │
│    ├─ Groceries         $600      $521         $79         ████████░░  │
│    ├─ Restaurants       $250      $234         $16         █████████░  │
│    ├─ Coffee            $100       $89         $11         █████████░  │
│    └─ Takeaway           $50       $48          $2         █████████░  │
│                                                                          │
│  Shopping               $500      $423         $77         ████████░░  │
│                                                                          │
│  Entertainment          $200      $200          $0         ██████████  │
│                                                  ⚠ Budget reached       │
│                                                                          │
│  Transport              $300      $215         $85         ███████░░░  │
│                                                                          │
│  ───────────────────────────────────────────────────────────────────     │
│  TOTAL                $2,000    $1,730        $270                      │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [e] Edit Budget  [a] Add Budget  [r] Reset  [←/→] Month  [d] Dashboard │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Budget - Edit Modal
```
┌─ Budgets ───────────────────────────────────────────────────────────────┐
│  February 2026                                           18 days left   │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│  CATEGORY              BUDGET    ┌─ Edit Budget ────────────────────┐   │
│  ───────────────────────────────│                                    │   │
│                                 │  Category: Food                    │   │
│▶ Food                  $1,000   │                                    │   │
│    ├─ Groceries         $600    │  Monthly Budget: [$1000      ]    │   │
│    ├─ Restaurants       $250    │                                    │   │
│    └─ Coffee            $100    │  Rollover unused?  [○] Yes [●] No │   │
│                                 │                                    │   │
│  Shopping               $500    │  Alert at: [80]% of budget        │   │
│                                 │                                    │   │
│  Entertainment          $200    │  ────────────────────────────     │   │
│                                 │  [enter] Save  [esc] Cancel       │   │
│                                 │  [d] Delete budget                │   │
│                                 └────────────────────────────────────┘   │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [e] Edit Budget  [a] Add Budget  [r] Reset  [←/→] Month  [d] Dashboard │
└──────────────────────────────────────────────────────────────────────────┘
```

---

### 6. Import View

```
┌─ Import ────────────────────────────────────────────────────────────────┐
│  Import Transactions from CSV                                            │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│  FILE                                                                    │
│  ───────────────────────────────────────────────────────────────────     │
│  Path: [/Users/jask/Downloads/ANZ_Feb2026.csv                      ]    │
│                                                                          │
│  IMPORT SETTINGS                                                         │
│  ───────────────────────────────────────────────────────────────────     │
│  Account:      [ANZ Checking              ▼]                            │
│  Format:       [ANZ (auto-detected)       ▼]                            │
│  Date format:  DD/MM/YYYY                                               │
│                                                                          │
│  PREVIEW (first 5 rows)                                                  │
│  ───────────────────────────────────────────────────────────────────     │
│  DATE        DESCRIPTION                              AMOUNT             │
│  02/03/2026  UBER EATS* SUSHI PLACE                   -$23.50           │
│  02/03/2026  SPOTIFY                                  -$10.99           │
│  02/02/2026  AMAZON.COM*XYZ123                        -$54.99           │
│  02/01/2026  WOOLWORTHS 1234                          -$87.32           │
│  02/01/2026  SALARY ACME CORP                       +$4500.00           │
│                                                                          │
│  Found 47 transactions • 3 potential duplicates will be flagged         │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [enter] Import  [p] Preview All  [esc] Cancel                          │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Import - Progress
```
┌─ Import ────────────────────────────────────────────────────────────────┐
│  Import Transactions from CSV                                            │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│                                                                          │
│                                                                          │
│                        Importing transactions...                         │
│                                                                          │
│                    ████████████████░░░░░░░░  34/47                       │
│                                                                          │
│                    ✓ 34 imported                                         │
│                    ○ 13 remaining                                        │
│                    ⟳ Checking for duplicates...                          │
│                                                                          │
│                                                                          │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [x] Cancel import                                                       │
└──────────────────────────────────────────────────────────────────────────┘
```

#### Import - Complete
```
┌─ Import ────────────────────────────────────────────────────────────────┐
│  Import Transactions from CSV                                            │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│                                                                          │
│                        ✓  Import Complete                                │
│                                                                          │
│                    ───────────────────────────                           │
│                                                                          │
│                    47 transactions imported                              │
│                     3 duplicates skipped                                 │
│                     2 potential matches queued for review                │
│                                                                          │
│                    ───────────────────────────                           │
│                                                                          │
│                    AI categorization started in background...            │
│                    12 uncategorized transactions queued                  │
│                                                                          │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [t] View Transactions  [r] Review Matches  [i] Import Another  [d] Done│
└──────────────────────────────────────────────────────────────────────────┘
```

---

### 7. Accounts View (Phase 2)

```
┌─ Accounts ──────────────────────────────────────────────────────────────┐
│  Manage Accounts                                        Total: $15,626  │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│  ACCOUNT              TYPE        BALANCE     LAST UPDATED              │
│  ───────────────────────────────────────────────────────────────────     │
│                                                                          │
│▶ ANZ Checking         Checking     $4,521     Today                      │
│    Last: UBER EATS* SUSHI PLACE -$23.50                                 │
│                                                                          │
│  ANZ Savings          Savings     $12,350     Yesterday                  │
│    Last: TRANSFER FROM CHECKING +$500.00                                │
│                                                                          │
│  Amex Platinum        Credit      -$1,245     3 days ago                 │
│    Last: QANTAS FLIGHTS -$450.00                                        │
│                                                                          │
│  Vanguard ETF         Investment  $45,230     1 week ago                 │
│    Last: Monthly contribution +$500.00                                  │
│                                                                          │
│                                                                          │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [a] Add Account  [e] Edit  [i] Import  [t] Transactions  [d] Dashboard │
└──────────────────────────────────────────────────────────────────────────┘
```

---

### 8. Help Overlay

```
┌─ JaskMoney ─────────────────────────────────────────────────────────────┐
│                                                                          │
│  February 2026      ┌─ Keyboard Shortcuts ─────────────────────────────┐│
│  ═══════════════════│                                                   ││
│                     │  NAVIGATION                                       ││
│  TOP CATEGORIES     │  ───────────────────────────────────────────     ││
│  ────────────────── │  d        Dashboard                               ││
│                     │  t        Transactions                            ││
│  Food          $892 │  r        Reconciliation queue                    ││
│  Fixed Costs   $650 │  b        Budgets                                 ││
│  Shopping      $423 │  a        Accounts                                ││
│  Transport     $215 │  i        Import                                  ││
│                     │  ?        This help screen                        ││
│  RECENT ACTIVITY    │  q        Quit                                    ││
│  ────────────────── │                                                   ││
│                     │  LISTS                                            ││
│  Today              │  ───────────────────────────────────────────     ││
│    UBER EATS  -$23  │  j/↓      Move down                               ││
│    SPOTIFY    -$10  │  k/↑      Move up                                 ││
│                     │  g        Go to top                               ││
│  Yesterday          │  G        Go to bottom                            ││
│    AMAZON     -$54  │  /        Search                                  ││
│    WOOLWORTHS -$87  │  enter    Select / Open details                   ││
│                     │                                                   ││
│  ════════════════════│  ACTIONS                                         ││
│  [t] Transactions  [│  ───────────────────────────────────────────     ││
│                     │  c        Categorize selected                     ││
│                     │  e        Edit selected                           ││
│                     │  a        AI categorize                           ││
│                     │  y        Merge (in reconciliation)               ││
│                     │  n        Dismiss (in reconciliation)             ││
│                     │                                                   ││
│                     │  [esc] Close help                                 ││
│                     └───────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────────────────────────┘
```

---

### 9. Tag Editor Modal

```
┌─ Transactions ──────────────────────────────────────────────────────────┐
│  February 2026  │  Account: All  │  Category: All  │  47 transactions   │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│  02/03  UBER EATS* SUSHI PLACE      ┌─ Edit Tags ─────────────────────┐ │
│  02/03  SPOTIFY                     │                                  │ │
│▶ 02/02  AMAZON.COM*XYZ123           │  Current tags:                   │ │
│  02/02  TRANSFER TO SAVINGS         │  ────────────────────────────   │ │
│  02/01  WOOLWORTHS 1234             │  [online] [×]  [shopping] [×]   │ │
│                                     │                                  │ │
│                                     │  Add tag: [gift for mom     ]   │ │
│                                     │                                  │ │
│                                     │  Suggestions:                    │ │
│                                     │  ────────────────────────────   │ │
│                                     │  gifts  gift  birthday          │ │
│                                     │  mom  mother  family            │ │
│                                     │                                  │ │
│                                     │  ────────────────────────────   │ │
│                                     │  [enter] Add  [esc] Done        │ │
│                                     └──────────────────────────────────┘ │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [c] Categorize  [e] Edit  [t] Tags  [/] Search  [f] Filter  [d] Back   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

### 10. Error States

#### Connection Error
```
┌─ JaskMoney ─────────────────────────────────────────────────────────────┐
│                                                                          │
│  February 2026                                                           │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│                                                                          │
│                        ✗  Database Error                                 │
│                                                                          │
│                    Could not open database file:                         │
│                    /home/jask/.local/share/jaskmoney/jaskmoney.db       │
│                                                                          │
│                    Error: SQLITE_CANTOPEN                                │
│                                                                          │
│                    Possible fixes:                                       │
│                    • Check if the directory exists                       │
│                    • Check file permissions                              │
│                    • Close other instances of JaskMoney                  │
│                                                                          │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [r] Retry  [c] Create New DB  [q] Quit                                 │
└──────────────────────────────────────────────────────────────────────────┘
```

#### LLM Error (Non-blocking)
```
┌─ Transactions ──────────────────────────────────────────────────────────┐
│  February 2026  │  Account: All  │  Category: All  │  47 transactions   │
│  ═══════════════════════════════════════════════════════════════════════ │
│                                                                          │
│  DATE   DESCRIPTION                      CATEGORY           AMOUNT      │
│  ─────────────────────────────────────────────────────────────────────   │
│  02/03  UBER EATS* SUSHI PLACE           Food > Takeaway       -$23.50  │
│  02/03  SPOTIFY                          Fixed > Subs          -$10.99  │
│▶ 02/02  AMAZON.COM*XYZ123                [uncategorized]       -$54.99  │
│                                                                          │
│  ┌─ AI Unavailable ─────────────────────────────────────────────────┐   │
│  │  ⚠  Could not connect to Gemini API                              │   │
│  │                                                                   │   │
│  │  Check your GEMINI_API_KEY environment variable                  │   │
│  │  or categorize manually with [c]                                 │   │
│  │                                                                   │   │
│  │  [r] Retry  [c] Categorize manually  [esc] Dismiss               │   │
│  └───────────────────────────────────────────────────────────────────┘   │
│                                                                          │
│  ═══════════════════════════════════════════════════════════════════════ │
│  [c] Categorize  [e] Edit  [t] Tags  [/] Search  [f] Filter  [d] Back   │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Keyboard Navigation & Accessibility

### Global Keys (available everywhere)
| Key | Action |
|-----|--------|
| `q` | Quit application |
| `?` | Show help overlay |
| `d` | Go to Dashboard |
| `t` | Go to Transactions |
| `r` | Go to Reconciliation |
| `b` | Go to Budgets |
| `i` | Go to Import |
| `Ctrl+C` | Force quit |

### List Navigation
| Key | Action |
|-----|--------|
| `j` / `↓` | Move cursor down |
| `k` / `↑` | Move cursor up |
| `g` | Go to first item |
| `G` | Go to last item |
| `Ctrl+d` | Page down |
| `Ctrl+u` | Page up |
| `/` | Open search |
| `Enter` | Select / Open detail |
| `Esc` | Close detail / Cancel |

### Transaction Actions
| Key | Action |
|-----|--------|
| `c` | Open category picker |
| `e` | Edit transaction |
| `t` | Edit tags |
| `m` | Add/edit comment |
| `a` | AI categorize selected |
| `A` | AI categorize all uncategorized |
| `f` | Open filter panel |

### Reconciliation Actions
| Key | Action |
|-----|--------|
| `y` | Merge (keep newer) |
| `n` | Not a duplicate |
| `s` | Skip for now |
| `←` / `→` | Navigate matches |

### Modal Navigation
| Key | Action |
|-----|--------|
| `Enter` | Confirm / Select |
| `Esc` | Cancel / Close |
| `Tab` | Next field |
| `Shift+Tab` | Previous field |

---

## Data Model

### Design Decisions

- **Amounts**: Stored as integers in cents to avoid floating-point precision issues
- **Timestamps**: Stored as UTC; default input/display timezone is Australia/Melbourne
- **Sign Convention**: Negative = expense (money out), Positive = income (money in)

### Implementation Assumptions (v1)

- **DB Constraints**:
  - `transactions.source_hash` unique when present.
  - `transactions.external_id` unique per `account_id` when present.
  - `tags.name` unique.
  - `transaction_tags` composite primary key `(transaction_id, tag_id)`.
  - Enum-like fields enforced via `CHECK` constraints.
- **Indexes**:
  - `transactions(account_id, date)` for list views and filters.
  - `transactions(status, date)` for dashboards.
  - `transactions(category_id)` and `transactions(merchant_name)` for filtering/search.
  - `pending_reconciliations(status)` for queue view.
- **Migrations**: `golang-migrate` with SQL files in `internal/database/migrations`.
- **Timezone**:
  - Persist timestamps in UTC.
  - UI date boundaries apply in configured local timezone.
  - `date` is derived from local timezone at ingestion and stored in UTC date form.
- **Categorization Precedence**:
  - User override (manual) > merchant rules > LLM suggestion.
  - LLM auto-apply only when confidence >= 0.70 and no user/category set.
  - Re-categorization only happens when user explicitly triggers it.
- **Reconciliation Merge Policy**:
  - Keep later/posted transaction as canonical.
  - Status on the earlier row set to `reconciled`; it is hidden by default filters.
  - For conflicts: prefer any user-entered fields (category/tags/comment) from either row.
- **Import Format (MVP)**:
  - ANZ CSV: `DD/MM/YYYY,description,amount` (no header)
  - Generic CSV: `date,posted_date,description,amount,external_id,account`
  - `amount` is decimal dollars; converted to cents integer.
  - `date` interpreted in UI timezone and stored as UTC date.
- **LLM Operational Defaults**:
  - Timeout 8s; retry once on transient errors.
  - Batch size 10; 1s delay between batches.
  - If LLM fails, fall back to "uncategorized" and log.
- **Logging**:
  - Text logs to stderr (TUI-safe).
  - `info` for normal operations, `warn` for recoverable failures, `error` for terminal failures.
- **Testing**:
  - Unit tests use in-memory SQLite.
  - Integration tests use file-based temp DB under `./tmp` or `t.TempDir()`.

### Core Schema

#### `accounts`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| name | TEXT | Display name (e.g., "ANZ Checking") |
| institution | TEXT | Bank/institution name |
| account_type | TEXT | checking, savings, credit, investment |
| balance | INTEGER | Current balance in cents (nullable) |
| created_at | DATETIME | UTC |
| updated_at | DATETIME | UTC |

#### `transactions`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| account_id | TEXT | FK to accounts |
| external_id | TEXT | Bank's reference (nullable) |
| date | DATE | Transaction date (UTC) |
| posted_date | DATE | Settlement date (nullable, UTC) |
| amount | INTEGER | Amount in cents (negative = expense) |
| balance_after | INTEGER | Running balance after this transaction (nullable) |
| raw_description | TEXT | Original description from bank |
| merchant_name | TEXT | Normalized merchant (nullable) |
| location | TEXT | Transaction location (nullable) |
| category_id | TEXT | FK to categories (nullable) |
| comment | TEXT | User notes (nullable) |
| status | TEXT | pending, posted, reconciled |
| source_hash | TEXT | Hash for dedup detection |
| created_at | DATETIME | UTC |
| updated_at | DATETIME | UTC |

#### `categories`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| parent_id | TEXT | FK to self (nullable for top-level) |
| name | TEXT | Category name |
| icon | TEXT | Emoji/icon (optional) |
| sort_order | INTEGER | Display order |

#### `tags`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| name | TEXT | Tag name (unique) |

#### `transaction_tags`
| Column | Type | Description |
|--------|------|-------------|
| transaction_id | TEXT | FK to transactions |
| tag_id | TEXT | FK to tags |

#### `merchant_rules`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| pattern | TEXT | Regex or exact match |
| pattern_type | TEXT | exact, contains, regex |
| category_id | TEXT | FK to categories |
| confidence | REAL | 0.0-1.0 |
| source | TEXT | user, llm |
| created_at | DATETIME | UTC |

#### `pending_reconciliations`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| transaction_a_id | TEXT | FK to transactions |
| transaction_b_id | TEXT | FK to transactions |
| similarity_score | REAL | 0.0-1.0 |
| llm_confidence | REAL | LLM's judgment (nullable) |
| llm_reasoning | TEXT | LLM explanation (nullable) |
| status | TEXT | pending, merged, dismissed |
| created_at | DATETIME | UTC |

#### `budgets` (Phase 2)
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| category_id | TEXT | FK to categories |
| amount | INTEGER | Monthly budget in cents |
| rollover | BOOLEAN | Roll unused budget to next month |
| alert_percent | INTEGER | Alert when this % is reached (default 80) |
| created_at | DATETIME | UTC |
| updated_at | DATETIME | UTC |

---

### Default Categories

```
Shopping
├── Clothing
├── Electronics
├── Home & Garden
└── General

Food
├── Groceries
├── Restaurants
├── Coffee & Drinks
└── Takeaway

Fixed Costs
├── Rent / Mortgage
├── Utilities
├── Insurance
├── Subscriptions
└── Phone & Internet

Investments & Savings
├── Savings Transfer
├── Investment Deposit
└── Retirement

Transport
├── Fuel
├── Public Transport
├── Parking
├── Rideshare
└── Maintenance

Health
├── Medical
├── Pharmacy
├── Fitness
└── Insurance

Entertainment
├── Streaming
├── Events
├── Hobbies
└── Games

Misc
├── Gifts
├── Fees & Charges
├── ATM Withdrawal
└── Uncategorized

Income
├── Salary
├── Freelance
├── Interest
├── Refund
└── Other Income
```

---

## LLM Integration

### Provider Interface

```go
type LLMProvider interface {
    Categorize(ctx context.Context, req CategorizeRequest) (CategorizeResponse, error)
    ReconciliationJudge(ctx context.Context, req ReconcileRequest) (ReconcileResponse, error)
    SuggestRule(ctx context.Context, req RuleRequest) (RuleResponse, error)
}
```

### Request/Response Structures

**CategorizeRequest:**
```json
{
  "transaction": {
    "description": "UBER EATS* SUSHI PLACE",
    "amount": -2350,
    "date": "2026-02-01",
    "account": "ANZ Checking"
  },
  "known_merchants": ["UBER EATS"],
  "categories": ["Food > Restaurants", "Food > Takeaway", ...],
  "similar_past_transactions": [
    {"description": "UBER EATS* PIZZA", "category": "Food > Takeaway"}
  ]
}
```

**CategorizeResponse:**
```json
{
  "category": "Food > Takeaway",
  "merchant_name": "Uber Eats",
  "confidence": 0.92,
  "suggested_rule": {
    "pattern": "UBER EATS*",
    "pattern_type": "contains",
    "applies_generally": true
  }
}
```

**ReconcileRequest:**
```json
{
  "transaction_a": {
    "description": "PENDING - AMAZON PURCHASE",
    "amount": -5499,
    "date": "2026-01-28"
  },
  "transaction_b": {
    "description": "AMAZON.COM*123ABC",
    "amount": -5499,
    "date": "2026-01-30"
  },
  "date_difference_days": 2
}
```

**ReconcileResponse:**
```json
{
  "is_duplicate": true,
  "confidence": 0.88,
  "reasoning": "Same amount, within 2 days, both Amazon - likely pending -> posted transition"
}
```

### Non-blocking Execution

- LLM calls run in goroutines
- Results delivered via channels to TUI message bus
- TUI shows spinner/indicator when LLM processing
- User can continue navigation while waiting
- Results update UI reactively when available

### Rate Limiting Strategy

- Batch uncategorized transactions for processing
- Process 10 transactions at a time
- 1 second delay between batches
- Respect API rate limits

---

## Duplicate Detection & Reconciliation

### Detection Algorithm

1. **Stage 1 - Exact Match Check:**
   - Same `external_id` -> auto-merge (no user prompt)
   - Same `source_hash` -> auto-merge

2. **Stage 2 - Fuzzy Match Detection:**
   ```
   Candidates where:
   - |amount_a - amount_b| == 0 (exact amount match)
   - |date_a - date_b| <= 7 days
   - Levenshtein(description_a, description_b) / max_len < 0.4
   ```

3. **Stage 3 - LLM Judge (for fuzzy matches):**
   - Triggered automatically for candidates
   - Adds confidence score + reasoning
   - Auto-merge if confidence >= 0.90
   - Queue for user review if confidence < 0.90

### Merge Behavior

- Keep the **later** transaction (posted > pending)
- Preserve any user-added metadata (category, tags, comment) from either
- Mark earlier transaction as `reconciled` (soft delete)

---

## Project Structure

```
jaskmoney/
├── cmd/
│   └── jaskmoney/
│       └── main.go              # Entry point
├── internal/
│   ├── config/
│   │   └── config.go            # Configuration loading
│   ├── database/
│   │   ├── db.go                # SQLite connection
│   │   ├── migrate.go           # Migration runner
│   │   ├── migrations/          # SQL migration files
│   │   └── repository/
│   │       ├── accounts.go
│   │       ├── transactions.go
│   │       ├── categories.go
│   │       ├── tags.go
│   │       ├── merchant_rules.go
│   │       ├── reconciliation.go
│   │       ├── budgets.go
│   │       └── models.go
│   ├── service/
│   │   ├── ingest.go            # CSV/data ingestion
│   │   ├── parsers/
│   │   │   ├── anz.go           # ANZ CSV parser
│   │   │   └── generic.go       # Generic CSV parser
│   │   ├── categorizer.go       # Auto-categorization logic
│   │   ├── reconciler.go        # Duplicate detection
│   │   ├── budget.go            # Budget calculations
│   │   └── export.go            # Data export
│   ├── llm/
│   │   ├── provider.go          # Provider interface
│   │   ├── gemini.go            # Gemini implementation
│   │   ├── mock.go              # Mock for testing
│   │   └── prompts.go           # Structured prompt templates
│   ├── tui/
│   │   ├── app.go               # Main Bubbletea app
│   │   ├── styles.go            # Lipgloss styles
│   │   ├── keys.go              # Keybindings
│   │   ├── layout/
│   │   │   └── grid.go          # Layout grid system
│   │   ├── views/
│   │   │   ├── dashboard.go
│   │   │   ├── transactions.go
│   │   │   ├── reconcile.go
│   │   │   ├── budgets.go
│   │   │   ├── accounts.go
│   │   │   ├── import.go
│   │   │   └── help.go
│   │   └── components/
│   │       ├── table.go
│   │       ├── bar.go
│   │       ├── modal.go
│   │       ├── filter.go
│   │       ├── category_picker.go
│   │       ├── tag_editor.go
│   │       └── spinner.go
│   ├── testdata/
│   │   └── generator.go         # Fake transaction generator
│   └── testutil/
│       └── integration.go       # Integration test helpers
├── .beads/                      # Beads task tracking
├── go.mod
├── go.sum
├── Makefile
├── SPEC.md
├── AGENTS.md
└── README.md
```

---

## Configuration

Location: `~/.config/jaskmoney/config.toml`

```toml
[database]
path = "~/.local/share/jaskmoney/jaskmoney.db"

[llm]
provider = "gemini"
api_key_env = "GEMINI_API_KEY"  # Read from env var
model = "gemini-2.5-flash-preview-05-20"
timeout = "8s"
batch_size = 10
batch_delay = "1s"

[ui]
date_format = "02/01"  # Go date format (DD/MM)
currency_symbol = "$"
timezone = "Australia/Melbourne"
theme = "default"  # default, minimal, colorful

[budgets]
# Monthly budgets per category (in dollars)
"Food" = 1000
"Food > Groceries" = 600
"Food > Restaurants" = 250
"Shopping" = 500
"Entertainment" = 200
"Transport" = 300

[import]
default_account = "ANZ Checking"
auto_categorize = true
```

---

## Development Phases

### Phase 1 - MVP (Current)

**In Scope:**
- [x] SQLite database with migrations
- [x] Fake transaction generator for testing
- [ ] Dashboard view (monthly spend, top categories, quick stats)
- [ ] Transaction list with filtering and search
- [ ] Manual categorization (category picker modal)
- [ ] Tag management
- [ ] Merchant rule storage (user-created + LLM-suggested)
- [ ] Duplicate detection (exact + fuzzy + LLM judge)
- [ ] Reconciliation queue view
- [ ] Gemini LLM integration (categorization + reconciliation)
- [ ] Non-blocking async LLM calls with status indicators
- [ ] ANZ CSV import
- [ ] Configuration with Viper
- [ ] Graceful error handling

### Phase 2 - Enhanced Features

**Scope:**
- [ ] Budget tracking and alerts
- [ ] Budget view with progress bars
- [ ] Multi-account management
- [ ] Account balances tracking
- [ ] Accounts view
- [ ] Additional CSV parsers (CBA, Westpac, NAB)
- [ ] Generic CSV import with column mapping
- [ ] CSV/JSON export
- [ ] Trend analysis (month-over-month comparison)
- [ ] Subcategory rollup in reports

### Phase 3 - Advanced Features

**Scope:**
- [ ] Alternative LLM providers (Claude, OpenAI, local)
- [ ] Recurring transaction detection
- [ ] Bill reminders
- [ ] Split transactions
- [ ] Multi-currency support
- [ ] Investment tracking integration
- [ ] API for external integrations
- [ ] Mobile-friendly web dashboard (optional)

---

## Dependencies

```go
// Core TUI
github.com/charmbracelet/bubbletea
github.com/charmbracelet/lipgloss
github.com/charmbracelet/bubbles

// Database
github.com/mattn/go-sqlite3
github.com/golang-migrate/migrate/v4

// LLM
github.com/google/generative-ai-go
google.golang.org/api

// Configuration
github.com/spf13/viper

// Utilities
github.com/google/uuid
github.com/agnivade/levenshtein

// Testing
github.com/stretchr/testify
```

---

## Performance Targets

| Metric | Target |
|--------|--------|
| Transaction list render (5k items) | 60fps, <16ms per frame |
| Initial load (5k transactions) | <500ms |
| Memory usage (idle) | <50MB |
| Memory usage (5k transactions) | <100MB |
| LLM categorization (single) | <8s |
| LLM batch (10 transactions) | <15s |
| Database query (list with filters) | <100ms |
| Import (1000 transactions) | <5s |

---

## Security Considerations

- **Local-first**: All data stored in local SQLite file
- **No telemetry**: No data sent anywhere except optional LLM calls
- **API key handling**: Read from environment variable, never stored in config
- **File permissions**: Database file created with 0600 permissions
- **No network by default**: LLM calls are optional; app works offline
