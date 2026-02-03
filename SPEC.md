# JaskMoney - Technical Specification v1.0

## Overview

**JaskMoney** is a terminal-based personal finance application built with Go and Bubbletea. It provides transaction management, automatic categorization via LLM, duplicate reconciliation, and spending dashboards.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                          TUI Layer                               │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  Dashboard  │  │ Transaction │  │  Reconciliation Queue   │  │
│  │    View     │  │    List     │  │         View            │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       Service Layer                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  Ingest      │  │ Categorizer  │  │  Reconciliation      │   │
│  │  Service     │  │   Service    │  │     Service          │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        LLM Layer                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  LLM Client (Gemini 2.5 Flash, swappable provider)       │   │
│  │  - Structured prompts                                     │   │
│  │  - Confidence scoring                                     │   │
│  │  - Async/non-blocking                                     │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Data Layer                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │  SQLite DB   │  │  Repository  │  │  Migration Manager   │   │
│  │              │  │   Pattern    │  │                      │   │
│  └──────────────┘  └──────────────┘  └──────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

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
  - LLM auto-apply only when confidence ≥ 0.70 and no user/category set.
  - Re-categorization only happens when user explicitly triggers it.
- **Reconciliation Merge Policy**:
  - Keep later/posted transaction as canonical.
  - Status on the earlier row set to `reconciled`; it is hidden by default filters.
  - For conflicts: prefer any user-entered fields (category/tags/comment) from either row.
- **Import Format (MVP)**:
  - CSV with headers: `date, posted_date, description, amount, external_id, account`.
  - `amount` is decimal dollars; converted to cents integer.
  - `date` interpreted in UI timezone and stored as UTC date.
- **LLM Operational Defaults**:
  - Timeout 8s; retry once on transient errors.
  - Batch size 10; 1s delay between batches.
  - If LLM fails, fall back to “uncategorized” and log.
- **Logging**:
  - Text logs to stderr.
  - `info` for normal operations, `warn` for recoverable failures, `error` for terminal failures.
- **Testing**:
  - Unit tests use in-memory SQLite.
  - Integration tests use file-based temp DB under `./tmp` or `t.TempDir()`.

### Core Schema

#### `accounts`
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (UUID) | Primary key |
| name | TEXT | Display name (e.g., "Chase Checking") |
| institution | TEXT | Bank/institution name |
| account_type | TEXT | checking, savings, credit, investment |
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
| raw_description | TEXT | Original description from bank |
| merchant_name | TEXT | Normalized merchant (nullable) |
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

Misc
├── Transport
├── Health
├── Entertainment
├── Gifts
├── Fees & Charges
└── Uncategorized
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
    "account": "Chase Checking"
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
  "reasoning": "Same amount, within 2 days, both Amazon - likely pending → posted transition"
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
   - Same `external_id` → auto-merge (no user prompt)
   - Same `source_hash` → auto-merge

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
   - Queued for user review in reconciliation view

### Merge Behavior

- Keep the **later** transaction (posted > pending)
- Preserve any user-added metadata (category, tags, comment) from either
- Mark earlier transaction as `reconciled` (soft delete)

---

## TUI Views

### 1. Dashboard (Home)

```
┌─ JaskMoney ─────────────────────────────────────────────────────┐
│                                                                  │
│  February 2026                           Total Spend: $3,245.67 │
│  ═══════════════════════════════════════════════════════════════│
│                                                                  │
│  Top Categories                          │  Quick Stats         │
│  ────────────────────────────────────────│  ──────────────────  │
│  Food              $892.34  ████████░░   │  Transactions: 47    │
│  Fixed Costs       $650.00  █████░░░░░   │  Uncategorized: 12   │
│  Shopping          $423.11  ████░░░░░░   │  Pending Recon: 3    │
│  Transport         $215.00  ██░░░░░░░░   │                      │
│                                          │                      │
│  ════════════════════════════════════════════════════════════════│
│  [t] Transactions  [r] Reconcile (3)  [i] Import  [q] Quit      │
└──────────────────────────────────────────────────────────────────┘
```

### 2. Transaction List

```
┌─ Transactions ──────────────────────────────────────────────────┐
│  Filter: All  │  Account: All  │  Category: All  │  Feb 2026   │
│  ═══════════════════════════════════════════════════════════════│
│                                                                  │
│  02/03  UBER EATS* SUSHI PLACE        Food > Takeaway   -$23.50 │
│  02/03  SPOTIFY                       Fixed > Subs      -$10.99 │
│▶ 02/02  AMAZON.COM*XYZ123             [uncategorized]   -$54.99 │
│  02/01  WOOLWORTHS 1234               Food > Groceries  -$87.32 │
│  02/01  SALARY ACME CORP              [income]        +$4500.00 │
│                                                                  │
│  ════════════════════════════════════════════════════════════════│
│  [c] Categorize  [t] Tags  [m] Comment  [a] AI Suggest  [/] Find│
└──────────────────────────────────────────────────────────────────┘
```

### 3. Reconciliation Queue

```
┌─ Reconciliation ────────────────────────────────────────────────┐
│  Potential Duplicates (3 pending)                               │
│  ═══════════════════════════════════════════════════════════════│
│                                                                  │
│  Match 1 of 3                              Confidence: 88%      │
│  ──────────────────────────────────────────────────────────────  │
│  A: 01/28  PENDING - AMAZON PURCHASE              -$54.99       │
│  B: 01/30  AMAZON.COM*123ABC                      -$54.99       │
│                                                                  │
│  AI Analysis: "Same amount, within 2 days, both Amazon -        │
│               likely pending → posted transition"               │
│                                                                  │
│  ════════════════════════════════════════════════════════════════│
│  [y] Merge (keep B)  [n] Not duplicate  [s] Skip  [q] Back      │
└──────────────────────────────────────────────────────────────────┘
```

### 4. Category Picker (Modal)

```
┌─ Select Category ───────────────────┐
│  > Food                             │
│    ├─ Groceries                     │
│    ├─ Restaurants                   │
│    ├─ Coffee & Drinks               │
│    └─ Takeaway           ◀ selected │
│    Shopping                         │
│    Fixed Costs                      │
│    ...                              │
│  ────────────────────────────────── │
│  [enter] Select  [esc] Cancel       │
└─────────────────────────────────────┘
```

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
│   │   ├── migrations/          # SQL migration files
│   │   └── repository/
│   │       ├── accounts.go
│   │       ├── transactions.go
│   │       ├── categories.go
│   │       └── reconciliation.go
│   ├── service/
│   │   ├── ingest.go            # CSV/data ingestion
│   │   ├── categorizer.go       # Auto-categorization logic
│   │   └── reconciler.go        # Duplicate detection
│   ├── llm/
│   │   ├── provider.go          # Provider interface
│   │   ├── gemini.go            # Gemini implementation
│   │   └── prompts.go           # Structured prompt templates
│   ├── tui/
│   │   ├── app.go               # Main Bubbletea app
│   │   ├── styles.go            # Lipgloss styles
│   │   ├── keys.go              # Keybindings
│   │   ├── views/
│   │   │   ├── dashboard.go
│   │   │   ├── transactions.go
│   │   │   ├── reconcile.go
│   │   │   └── category_picker.go
│   │   └── components/
│   │       ├── table.go
│   │       ├── sparkline.go
│   │       └── modal.go
│   └── testdata/
│       └── generator.go         # Fake transaction generator
├── go.mod
├── go.sum
├── Makefile
└── SPEC.md
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

[ui]
date_format = "02/01"  # Go date format (MM/DD)
currency_symbol = "$"
timezone = "Australia/Melbourne"
```

---

## MVP Scope (Phase 1)

**In Scope:**
- [ ] SQLite database with migrations
- [ ] Fake transaction generator for testing
- [ ] Dashboard view (monthly spend, top categories)
- [ ] Transaction list with filtering
- [ ] Manual categorization (category picker)
- [ ] Tag management
- [ ] Merchant rule storage (user-created)
- [ ] Basic duplicate detection (exact amount + date window)
- [ ] Reconciliation queue view
- [ ] Gemini LLM integration (categorization + reconciliation judge)
- [ ] Non-blocking async LLM calls

**Deferred to Phase 2:**
- CSV import from real banks
- Budget tracking
- Multi-account balance tracking
- Export functionality
- Trend analysis / charts
- Alternative LLM providers

---

## Dependencies

```go
// Core
github.com/charmbracelet/bubbletea
github.com/charmbracelet/lipgloss
github.com/charmbracelet/bubbles

// Database
github.com/mattn/go-sqlite3
github.com/golang-migrate/migrate/v4

// LLM
github.com/google/generative-ai-go

// Utilities
github.com/google/uuid
github.com/spf13/viper          // Config
github.com/agnivade/levenshtein // Fuzzy matching
```
