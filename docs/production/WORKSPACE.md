# Persistent workspace

The same-origin browser workspace has six connected views: overview,
conversations and plans, tasks and reports, explicit preferences, scoped budgets,
and activity. All private API owners come from the signed wallet session.
Neither browser-supplied owner IDs nor language-model output select an owner.

## Conversation to task

1. `POST /api/conversations {useMemory:false}` creates a private aggregate.
2. `POST /api/conversations/:id/messages` accepts `clientRequestId`,
   `expectedRevision`, `text` and optional explicit wallet/start/end `scope`.
   The first user's text is only a draft purpose. The actual refiner must review
   it; explicit wallet and dates are not inferred from remembered preferences.
3. `POST /api/conversations/:id/plan` accepts a new request ID and current
   revision. A separate planner and critic run through bounded server processes.
4. `POST /api/conversations/:id/confirm` accepts the exact `planHash`, revision,
   wallet, start/end, optional `mandateId` and `acknowledge:true`. This creates a
   task, not a payment. The server binds the immutable conversation/plan/intent
   version, registered resource and mandate version into the task and quote.
5. The existing task quote, exact approval, execution, original-transaction
   reconciliation and same-proof recovery paths remain mandatory.

Model context contains the latest twelve messages, the compact current intent,
up to five explicitly opted-in preferences and a fixed resource catalog. It
contains no session cookie, database access, payer key, payment proof or signing
port. A planner has no execution tools. `wallet-transfers` is the current real
capability; the UI does not invent available providers or analysis products.

Each conversation has at most 100 durable request IDs and 100 messages. Lists
return summaries, and detail reads return twenty messages with a previous-message
cursor. Page limits are 1–50 (default 20). No model runs on a GET or refresh.

A request ID is checked before a retry can claim work. A different body with the
same ID conflicts. A matching retry returns the durable current state and never
silently calls the model again. A failed request needs an explicit new request
ID for another model attempt. Only the revision that was actually validated can
be used for a compare-and-swap; guessing a later revision cannot apply an older
plan. An operation lease prevents overlapping model work in one conversation.

Task linkage uses the conversation UUID as the task UUID and a stable,
owner-scoped idempotency key. The first confirmation durably locks its exact
plan, scope and optional mandate before the task write. A stalled or uncertain
write never unlocks that intent for a different plan. Reads can repair an exact
existing link, and explicit retries reuse the same occurrence. No task is
replaced because its financial outcome is uncertain.

## Preferences and isolation

`GET/POST /api/memories` and `DELETE /api/memories/:id` support explicit user
consent, bounded preference fields, revision-checked removal and expiry within
90 days. Credential, financial and authority labels and unregistered external
URLs are rejected. Preferences can influence language/style, never report
scope, budgets, payees, private keys or authorization. A deletion/expiry/version
change while the model is running stops publication of that response.

Removal makes a preference unavailable immediately to lists, reads and future
model context. The row is retained as a deleted database record; activity stores
only record identifiers, event types, versions and times, not raw text. This is
not a claim of a separate full data-retention or regulatory-erasure program.

All private asynchronous responses recheck the server session. Both browser
clients discard late responses from previous wallet generations. Owner changes
clear task/conversation/result DOM, financial approval checkboxes and private
form drafts; acknowledgement is bound to one exact conversation and plan.
Current-session 401 responses also clear the shared login state.

## Budgets, history and operation bounds

See [MANDATES.md](MANDATES.md) for atomic budget reservations, immutable payment
observations and the pre-ledger import barrier. An incompatible mandate is
rejected before permanently locking a conversation. Budget cards show exact
integer-derived token amounts and owner-only UTC-day counters. Older unresolved
holds remain in the ledger; they are not reported as today's holds or released
by a timeout. The service-wide daily cap is a configured cap, not another
owner's balance.

`GET /api/tasks` returns summary-only cursor pages. Large report bodies, proofs,
quotes, approvals and event arrays are loaded only through the owner-checked
detail route. Archive preserves evidence and refuses uncertain or in-flight
work; restore respects the active-task cap. Owner-scoped create idempotency
prevents client retry duplicates.

`GET /api/dashboard`, `/api/catalog`, `/api/activity` and `/api/mandates` expose
bounded views of durable state. There are no fabricated metrics or activities.

Concurrent expensive work defaults to four per process and two per owner, with
429/Retry-After on saturation. Model request slots are atomically reserved in
the database: 60 global and 20 per owner per UTC day by default. A plan costs two
slots; uncertain model attempts are not refunded. These are call-count bounds,
not a currency budget or a provider billing report. Multiple application
processes share the database quotas and financial ledger; operation/process
limits are local to each process.

## Release boundary

Production-oriented implementation is separate from external acceptance. The
service remains Devnet-only with payments off by default. Passing local or
isolated-PostgreSQL tests does not prove a user's Phantom browser approval,
funded Devnet purchase or public-cloud release. Never enable mainnet, change
signing authority, widen repository app permissions or claim a deployment merely
because a local health route or infrastructure file exists.
