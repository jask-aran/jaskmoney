# Reference Captures

Each capture exists in three formats:

- **`.ansi`** — raw `model.View()` output with ANSI SGR escape codes (full colour)
- **`.txt`** — ANSI-stripped deterministic text for diffing and agent consumption
- **`.png`** — pixel raster via `scripts/ansi2png.py` (Meslo Nerd Font Mono when available, else Liberation/DejaVu; 9×18 px cells)

They are **reference captures**, not golden snapshots — the OpenTUI
implementation should preserve information architecture and state legibility,
but is not required to match byte-for-byte.

Hero / marketing screenshots are captured manually in Windows Terminal and
live outside this pipeline.

## Generation

```bash
./scripts/gen-refs.sh
```

Requires `go`, `python3`, and Pillow (`pip3 install pillow`).

What the script does:

1. `CLICOLOR_FORCE=1 COLORTERM=truecolor go run -tags reference_gen .`
   - Freezes `appNow()` to **2026-02-18** so lookback presets include fixture rows
   - Forces truecolor lipgloss profile
   - Writes `.ansi` + `.txt` for every capture (status bar + footer included)
2. `scripts/ansi2png.py` rasters each `.ansi` → `.png` at fixed 140×44 (70×44 for narrow)

## Fixture clock and data

- Frozen now: **2026-02-18 12:00 local** (`setAppNow` in `gen_reference.go`)
- Transactions span **Aug 2025 → Feb 2026** (56 rows). First 20 ids are the classic Feb manager table.
- Dashboard period anchors use explicit dates (e.g. Month → `2026-02-01`, QTR → `2025-10-01`) so bounds do not depend on the host calendar.

## Status bar

Line `height-2` is the status bar (`renderStatus`); line `height-1` is the footer.
Every capture sets a non-empty `m.status` so the bar is legible in `.txt` and `.png`.
Earlier dumps looked “status-less” because:

1. `m.status` was left empty, and
2. `ansi2png.py` stripped trailing space-only lines (which dropped the bg-padded status/footer).

## Manager modals covered

| Capture | Modal |
|---|---|
| `reference-manager-cat-picker` | Quick Categorize |
| `reference-manager-tag-picker` | Quick Tags (simple on/off) |
| `reference-manager-tag-picker-mixed` | Quick Tags tri-state / dirty |
| `reference-manager-allocation` | Create allocation |
| `reference-manager-detail` | Transaction detail |
| `reference-manager-filter-picker` | Load saved filter |
| `reference-manager-account-modal` | Create account |
| `reference-dry-run-results` | Rules dry-run |
| `reference-import-picker` / `preview` | Import flow |

## Manifest (39 captures)

### Dashboard (9)

| Reference | Viewport | Notes |
|---|---|---|
| `reference-dashboard-base` | 140×44 | Period **Month** Feb 2026, populated |
| `reference-dashboard-period-qtr` | 140×44 | Period **QTR** Oct–Dec 2025 |
| `reference-dashboard-lookback-1y` | 140×44 | Lookback **1Y** |
| `reference-dashboard-lookback-3m` | 140×44 | Lookback **3M** |
| `reference-dashboard-date-focus` | 140×44 | Date-range pane focused |
| `reference-dashboard-cashflow-focus` | 140×44 | Cashflow pane focused |
| `reference-dashboard-composition-focus` | 140×44 | Composition pane focused |
| `reference-dashboard-narrow` | 70×44 | Stacked analytics |
| `reference-dashboard-drill-return` | 140×44 | Manager after dashboard drill |

### Manager (13)

`base`, `accounts`, `detail`, `cat-picker`, `tag-picker`, `tag-picker-mixed`, `allocation`, `allocation-child-selected`, `range-highlight`, `filter`, `filter-picker`, `account-modal`, `dry-run-results`

### Budget (4, kept as-is)

`table`, `planner`, `edit`, `delete-armed`

### Import / nav / settings (13)

`import-picker`, `import-preview`, `jump-mode`, `jump-mode-settings`, `command-palette`, `colon-mode`, `settings-base`, `settings-cats-active`, `settings-tags-active`, `settings-rules-list`, `settings-rules-editor`, `settings-filters-editor`, `settings-filters-editor-invalid`

## Ignore when porting

- Exact braille sparkline glyphs
- Exact PNG pixel match (font AA differs from Windows Terminal)
- Budget tab behaviour beyond the four existing captures (not a port priority)
