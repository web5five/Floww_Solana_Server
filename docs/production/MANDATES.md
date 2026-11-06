# Registered resources, mandates and aggregate budgets

`service/mandates.mjs` exports the asynchronous factory
`createMandateService({store,config})`. It reuses the existing private SQLite
connection or PostgreSQL pool. PostgreSQL tables are confined to the existing
`floww_runtime` schema; this module creates no schema, role, grant or database.

## Resource catalog

`catalog()` returns one registered resource with stable ID and capability
`wallet-transfers`. Its public fields are `id`, `name`, `description`,
`capability`, `capabilities`, `dataNetwork`, `network`, `maxWindowDays`, `coverage`
and `status`. Coverage describes confirmed wallet transactions, native SOL/SPL
observations and bounded history; it does not promise complete history,
finalization, balances or profit. `AVAILABLE` denotes a configured registered
merchant, not a successful live payment. Missing merchant configuration returns
`SETUP_REQUIRED`, and mandate creation then fails with a fixed error.

The planner receives an allowlisted projection of these descriptive fields.
Models never choose a URL, mint, recipient, price, facilitator or signing key.
The actual purchase still uses the backend's exact saved quote and approval.

## Owner-scoped mandates

`create(owner,input)` accepts only:

```text
purpose, wallet, windowStart, windowEnd, budgetAtomic, perPurchaseAtomic,
expiresAt, maxExecutions, acknowledge:true
```

The owner comes from authentication. Purpose is normalized to NFC. Windows are
valid UTC dates, at most seven days long, and cannot extend into the future.
Expiry is future and at most thirty days away. Amounts are positive canonical
integer strings, per-purchase cap cannot exceed `maxPaymentAtomic`, and total
budget is between one per-purchase cap and `perPurchaseAtomic*maxExecutions`.
Execution count is an integer in `1..100`. The registered capability, Devnet,
asset and recipient are copied from server configuration. No payment approval
is created by a mandate.

`get(owner,id)`, `list(owner)` and `revoke(owner,id,expectedVersion)` expose only
that owner's records. Versions are numbers starting at `1`; revocation increments
the version and changes its hash while retaining counters and prior facts.
Lists return at most one hundred recent records. An owner may retain at most one
hundred unrevoked, unexpired mandates; revoke an unused mandate to free a slot.

A task linked by server-owned `workspaceContext` must match the mandate's exact
normalized purpose and wallet, stay inside its data window, and name its current
version and the registered resource. Exact quote approval remains separate.
The record includes immutable scope/limits, `id`, `version`, `hash`, timestamps,
`status`, `spentAtomic`, `heldAtomic`, `remainingAtomic`, `executionsSpent`,
`executionsHeld` and `remainingExecutions`.

## Execution hooks and crash behavior

1. `reserve(owner,task)` runs after fresh quote and exact approval validation,
   before the core task becomes `SIGNING`. It rereads the durable task, binds its
   complete quote/private terms, approval, purpose, wallet, window and immutable
   workspace context, and records one unique `HELD` reservation for that task.
2. `assertReservation(owner,task)` runs inside the restricted signer's final
   callback. The durable task must be `SIGNING` with an attempt ID and without
   signed data. It rechecks current authority, mandate version/scope/expiry,
   original reservation and aggregate limits. A reservation from an earlier UTC
   date cannot fund a new signature after midnight.
3. `observe(owner,task)` runs after the core's payment fact is durable. The
   ledger consumes that saved task, not a caller-supplied success flag. A bound
   `CONFIRMED` payment with original proof fields and a transaction reference
   moves `HELD` to `SPENT` exactly once. Missing delivery does not change spending.
   Subsequent stale observations cannot reduce recorded spend.

Every new execution, including a manually created task without a mandate, uses
the global service-payer daily limit. Effective cap is:

```text
min(config.dailyPaymentAtomic ?? config.maxPaymentAtomic,
    config.maxPaymentAtomic)
```

Inside one transaction the ledger checks
`spent + held + requested <= cap` and, for mandates, both aggregate budget and
execution-count limits. PostgreSQL locks the task, then payer/day, then mandate;
SQLite executes its entire transaction synchronously under `BEGIN IMMEDIATE`.
Own `workspace_budget_buckets` counters make checks independent of ledger length
and avoid SQLite numeric rounding. No other owner's totals enter public views.

A crash after reservation but before the core claim retains the hold. Only that
same logical task, original quote and original approval may reuse it. A core
`SIGNING`, `PENDING` or `UNKNOWN` task cannot start a replacement execution.
Revocation, expiration, logout, restart, generic `FAILED` and HTTP errors never
release a hold. This implementation deliberately has no automatic release path:
a later reviewed release requires conclusive exact-transfer failure evidence.
Payment reconciliation and delivery recovery continue with the original proof.

## Dashboard and rollout boundary

`dashboard(owner)` returns the current UTC `day`, shared `dailyLimitAtomic`,
that owner's current-day spent/held amounts and execution counts,
`activeMandates`, and at most fifty recent reservation summaries. A reservation
keeps its original day; an older unresolved hold remains in its original bucket
and in history. Raw proofs, private requirements and binding hashes are omitted.

Pre-upgrade purchases without ledger reservations are not silently assigned an
invented payment date. `readiness()` performs one bounded-result anti-join and
returns `{ready,reasonCode}` without IDs, counts, amounts or proofs. Any task
without a matching owner/task reservation that is `SIGNING`, `PENDING`,
`UNKNOWN`, `CONFIRMED`, or contains an attempt, proof or transaction, yields
`LEDGER_IMPORT_REQUIRED`. Both reserve and the final signer check then fail
closed with HTTP 503 for every owner. Health can expose this fixed readiness
reason. The controller must explicitly account for historical purchases before
enabling new ones; this service never guesses their dates or edits their facts.
Observation/reconciliation/recovery remain possible during this barrier, and
existing reservations retain their holds or monotonic spend. New manual and
mandate executions are counted through the execution hooks.

## Local evidence

`FLOWW_REQUIRE_POSTGRES_TESTS=true node --test test/mandates.test.mjs` runs the
same concurrency/owner/scope/restart tests against SQLite and an owned temporary
loopback PostgreSQL cluster, using already-installed binaries and dependencies.
The tests script core payment observations; they do not sign transactions,
transfer tokens, contact a facilitator, or prove live settlement. Temporary
database files and the PostgreSQL process are removed after the test run.
