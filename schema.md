# Water Station Ledger — Export Schema (version 5)

Any accounting tool that reads these files must rely only on **field names and enum keys** — never on display labels or currency symbols.

* Format: JSON (`.json`), UTF-8
* All money is an **integer number of centavos** (₱20.50 = `2050`). `currency` is `"PHP"`.
* All timestamps are ISO 8601 in UTC. Group by calendar day **in the file's `timezone`**.
* v4 only adds fields to v3. A v3 file is still readable (missing new fields mean "not recorded").

## Files the app makes

| File | `export_type` | `export_mode` | Use |
|---|---|---|---|
| `orders_YYYY-MM-DD_final.json` (End Day) | `orders` | `incremental` | Daily feed. Contains orders/expenses changed recently (with a 2-day overlap so a lost file is recovered by the next one) plus `day_close`. |
| `orders_YYYY-MM-DD_recovery.json` (Full export) | `orders` | `full` | Every order and expense on the device. |
| `ledger_backup_YYYY-MM-DD.json` | `app_backup` | – | Restoring the app itself. Not for accounting. |
| `sales_*.csv`, `expenses_*.csv` | – | – | Human spreadsheets (Excel/Sheets). |

## Import rules (for the accounting side)

1. **Key on `order_id` / `expense_id`.** If an id already exists, keep the copy with the newer `updated_at`; if equal or older, ignore the incoming one. Importing the same file twice is therefore harmless.
2. **Never skip a file because of its name or `closed_on`.** Two devices (different `device` codes) can export on the same day.
3. **Revenue day = calendar date of `paid_at` in `timezone`.** `closed_on` and filenames are informational only.
4. Revenue counts only orders with `status == "paid"` and `voided_at == null`. Unpaid delivered orders (`status == "delivered"`) are receivables, not revenue.
5. `export_mode: "full"` is a complete snapshot of one device. Merging it by id (rule 1) is always safe.
6. Treat every value as untrusted: validate ids against `^[A-Za-z0-9_-]{3,64}$`, clamp numbers, never put text into HTML unescaped.

## File-level fields

| Field | Type | Notes |
|---|---|---|
| `schema_version` | integer | `5` |
| `export_type` | string | `orders` \| `app_backup` |
| `export_mode` | string | `incremental` \| `full` (orders files) |
| `include_archive`, `is_final` | boolean | informational |
| `exported_at` | ISO 8601 | |
| `closed_on` | `YYYY-MM-DD` \| null | The business day End Day closed. Informational. |
| `covered_dates` | string[] | Dates present via `paid_at`. Informational. |
| `app` | `{name, version}` | |
| `currency`, `money_unit`, `timezone` | string | `PHP`, `centavo`, IANA name |
| `device` | string | Device code of the exporting device (new in v4) |
| `container_types`, `staff` | object | `{key: displayName}` — keys are stable, names may change |
| `day_close` | object \| null | See below (new in v4) |
| `orders` | array | Order records |
| `expenses` | array | Expense records (new in v4) |


## Order record
All money is **integer centavos** (₱25.00 = 2500). All times are ISO-8601 UTC. Group by day using the file's `timezone`.

| Field | Type | Notes |
|---|---|---|
| `order_id` | string | Unique, e.g. `OT-20261030-0001`. Import key. |
| `order_no` | string \| null | Short number for people, e.g. `T001` |
| `created_at`, `updated_at` | ISO | Newest `updated_at` wins on import |
| `delivered_at`, `paid_at`, `voided_at` | ISO \| null | `delivered_at` = served (pick-up) or handed over (delivery). Revenue counts on the `paid_at` day. |
| `status` | enum | `not_started`, `preparing`, `otw`, `delivered` (served, unpaid = utang), `paid`, `cancelled` |
| `fulfillment` | enum | `pickup` (walk-in) \| `delivery` |
| `priority` | bool | Rush order |
| `customer_name`, `customer_id` | string, string \| null | `no name` for anonymous walk-ins |
| `staff` | string \| null | Key in file-level `staff` map. Who handled the order (pick-ups too). |
| `deals` | `[{key,name,containers,total,count}]` | Special deals used; `total` = fixed price per deal (centavos) |
| `regular_qty`, `unit_price` | int | Regular quantity and price each (₱20 pick-up / ₱25 delivery by default) |
| `price_label` | string \| null | `Regular`, a preset name (e.g. `Family`), or `Modified` |
| `quantity` | int | = `regular_qty` + Σ `count × containers` |
| `total_price` | int | = `regular_qty × unit_price` + Σ `count × total` (unless amended manually; see `edits`) |
| `containers` | `{type: n}` | Per container type; sums to `quantity` |
| `empties_owed` | `{type: n}` | Empties the customer still has (delivery only) |
| `empties_short` | int | How many empties were NOT collected at delivery time (for rider analytics) |
| `empties_history` | `[{returned:{type:n}, at}]` | Later returns |
| `incentive_rate` | int | Centavos per container, snapshot when served. Incentive = `quantity × incentive_rate` (0 if voided/cancelled) |
| `payment_method` | `cash`\|`gcash`\|`other` \| null | |
| `payment_ref`, `amount_tendered` | string, int \| null | |
| `note`, `custom` | string, object | |
| `status_history` | `[{status, at}]` | Timeline for timers and rider analytics |
| `edits` | `[{at, changes, reason}]` | Audit trail of changes after payment |

## Expense record
| Field | Notes |
|---|---|
| `expense_id`, `date` (YYYY-MM-DD), `amount` | |
| `kind` | `expense` and `incentive_payout` count against profit. `advance` (money lent to staff) and `advance_repayment` do **not**. |
| `category` | Key in the app's categories (`incentive` for payouts) |
| `staff` | Key, for staff-related kinds |
| `paid_from` | `drawer` (affects expected cash) \| `owner` \| `salary` |
| `note`, `created_at`, `updated_at`, `voided_at` | |

## `day_close` (End Day cash reconciliation)
`close_id, date, closed_at, opening_float, cash_sales, drawer_expenses, expected_cash, counted_cash, variance, float_next, revenue, orders_paid, open_orders, note, denominations`.
`expected_cash = opening_float + cash collected that day − cash paid from the drawer`.

## Customer record
`customer_id, name, phone, address, note, lat, lng (reserved, null), created_at, updated_at`.

## Two totals for a day (important for the books)
* **Sales taken** – orders created that day (what the paper notebook page adds up).
* **Collected** – money received that day by `paid_at` (includes yesterday's utang paid today).

## Changes from v4 (schema 5)
* `fulfillment` is `pickup` or `delivery`; `rider` → `staff` (all orders); `deals[]` + `regular_qty` + `unit_price`; `containers` / `empties_owed` keyed by type; `priority`; `incentive_rate`.
* Expense `kind` and `staff`; customer `lat`/`lng`.
* Files with another `schema_version` are rejected by the importer.
