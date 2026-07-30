# Inventory Stock V1

Inventory Stock V1 is Brain's canonical, tenant-scoped stock foundation. It is deliberately quantity-only: prices, recipes, suppliers, purchasing, and automatic POS/camera consumption remain future work.

## Authority and transaction model

- `inventory_movements` is the append-only source of truth.
- `inventory_balances` is a transactionally maintained projection keyed by company, location, storage area, and item.
- A focused service-role RPC validates the persisted actor and all same-company scope, locks the balance, updates the projection, inserts the ledger row, and evaluates low stock in one database transaction.
- Quantity values cross the application boundary as decimal strings and are stored as `numeric(18,6)`.
- Stock cannot become negative.
- `inventory_operations` owns company-scoped idempotency keys and SHA-256 request fingerprints. A same-key/same-payload replay returns the durable result; a changed payload fails closed.
- Transfers lock both balance rows in UUID order and insert matched `transfer_out` and `transfer_in` rows atomically.

## Authorization

| Actor | Read stock | Mutate catalog/stock | Assigned counts | Approve counts |
| --- | --- | --- | --- | --- |
| manager / owner / super_admin | Same company | Yes, through server RPCs | Same company | Yes |
| employee | No general stock view | No | Only sessions assigned to persisted `employee_id` | No |
| inactive / unprovisioned / unauthenticated | No | No | No | No |

Browser clients receive authenticated `SELECT` only where an RLS policy allows it. They cannot write the ledger, balances, operations, thresholds, or counts directly. Mutation RPCs are executable only by `service_role`; the application derives actor and company identifiers from `ActorContext`.

## Count lifecycle

`draft -> counting -> submitted -> approved`, or a non-terminal session can become `cancelled`.

Expected quantities are captured by the database when the session is created. Employees can edit only assigned counting sessions. Approval locks the session and each balance, compares the current balance with the captured expected value, and fails with `INVENTORY_COUNT_STALE` if stock changed. A successful approval creates at most one reconciliation movement per item. Damaged quantity remains separate advisory count metadata.

## Low-stock delivery

A storage-area override takes precedence over the item default. Crossing below the effective threshold opens one deduplicated condition and appends one obligation to the existing `notification_outbox`. The existing worker first asks the inventory materializer whether it owns the obligation, then falls back to the existing task/system materializer.

Recipients are active same-company managers, owners, and super admins. Push text contains no stock amount, item name, company, or location; it links the authenticated recipient to Inventory. Recovery resolves the open condition. No cron job is added.

## Brain and Camera Evidence C5

Management Brain reads the canonical snapshot RPC and returns database-owned decimal strings with `evaluated_at`. Employee Brain receives only RLS-scoped assigned count sessions. V1 Brain mutations fail closed; the Inventory workspace is the only stock mutation path.

C5 currently stores a count label, canonical unit, decimal/damaged flags, and the employee submission. It has no explicit `inventory_item_id` or `storage_area_id`. Automatic reconciliation is therefore intentionally absent.

The future bridge must be explicit:

1. A task count requirement references a same-company inventory item and storage area.
2. The employee submits a structured count.
3. AI produces advisory evidence only.
4. An authorized manager approves the evidence and explicitly requests stock reconciliation.
5. One transaction locks the evidence, task, inventory link, count state, and current balance.
6. A deterministic idempotency key inserts one reconciliation operation and movement.

No item may ever be inferred from task text.

## Deployment order

1. Back up and validate the target database.
2. Apply `202607290001_inventory_stock_v1.sql` unchanged.
3. Run the commented read-only verification queries at the end of the migration.
4. Deploy the application revision containing the Inventory APIs, worker dispatch, Brain reads, and UI.
5. Perform authenticated, company-isolated smoke checks with no opening balances.
6. Create catalog items and storage areas explicitly; enter opening balances only as reviewed management operations.

## Preview acceptance

- Verify management can create an item and storage area in its own company only.
- Verify duplicate normalized names, SKU, and barcode fail safely.
- Verify receive, use, waste, adjustment, and transfer produce ledger/balance parity.
- Verify insufficient stock and same-area transfer fail without partial writes.
- Replay a request with the same key and confirm one operation; change the payload and confirm conflict.
- Run a count through draft, counting, submitted, and approved; verify stale approval fails.
- Verify an assigned employee can count but cannot see other stock/counts or approve.
- Verify low stock creates one privacy-safe notification and recovery closes the condition.
- Verify English/Arabic, RTL, mobile safe-area actions, keyboard entry, and no horizontal overflow.
- Verify Brain facts match the Inventory snapshot and Brain refuses stock mutations.

