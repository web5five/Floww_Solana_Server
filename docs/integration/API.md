# Local service and execution boundary

The service implements the integration contract in IMPLEMENTATION_SCOPE.md. It
introduces a new API; it is not a claim that the former team API was agreed or
deployed. Existing EVM services and shared databases are not modified.

Run `npm ci --ignore-scripts`, configure the names in `.env.example`, and run
`node --env-file=.env service/main.mjs`. Python 3.11+ must be available. A managed
Postgres adapter may be selected with DATABASE_URL; local development uses a
private SQLite file. The runtime never prints environment values or proofs.

Authentication starts at POST `/api/auth/challenge` with `{wallet}`. Sign the
exact returned UTF-8 `message` with that Ed25519 wallet and send
`{wallet,challengeId,signature}` to POST `/api/auth/verify`. `signature` is canonical
base64 of the 64-byte detached signature. The one-use origin-bound challenge
expires in five minutes. An HttpOnly/SameSite=Strict session cookie follows.
Every mutating request requires the exact configured Origin and JSON content.
All requests require the configured HTTP Host. No CORS grant is supplied.

Task creation POST `/api/tasks` accepts `purpose`, `wallet`, `windowStart` and
`windowEnd` (UTC ISO strings, explicit window at most seven days). It creates no
payment authority. An optional `Idempotency-Key` (1–200 allowed ASCII identifier
characters) binds this owner's logical request to a canonical body hash. A
same-key/same-body retry returns the saved task with 201; a changed body returns
409 IDEMPOTENCY_CONFLICT. The atomic task insert and replay mapping survive
restart; another owner has a separate key space. Callers must use the task
returned by the store, including on a replay.

POST `/:id/quote` with `{}` obtains an actual x402 V2 challenge
from the fixed report merchant. The response includes a public `quote` with
hash, integer amount, asset, recipient, actual service payer and expiry.

POST `/:id/approve` accepts `{quoteHash,budgetAtomic,expiresAt,acknowledge:true}`.
It authorizes only the quoted resource and payment tuple. POST `/:id/execute`
accepts `{approvalId}`. Before the signer, the service rechecks session, owner,
quote, approval, payer, expiry and amount. A durable claim is committed first;
no uncertain claim may create a replacement signature after timeout or restart.

POST `/:id/reconcile` with `{}` observes the saved payment; it never signs. A
confirmed-but-undelivered purchase can POST `/:id/recover` with `{}` to retrieve
the resource using its saved original proof. It cannot reach a new signing path.
POST `/:id/revoke` revokes future authority. Already observed payment evidence is
preserved. Result generation independently passes the delivered body through the
existing Python scope/payment/delivery and canonical-report validators.

GET `/api/tasks?limit=20&cursor=...&includeArchived=false` returns
`{tasks:[summary...],nextCursor:string|null}`. The default page is 20, maximum 50.
The stable cursor binds owner and archive filter, using creation time plus ID.
Summaries contain identity/scope/status, archivedAt, workspaceContext and
resultAvailable; they omit results, HTML, Markdown, events, raw bodies and
proofs. Fetch the selected task's detail lazily. The legacy internal
`store.list(owner)` remains an array for existing integration adapters;
`store.page(owner,options)` and `store.dashboard(owner)` supply bounded history
and all-history counts respectively. Dashboard fields are total, active,
archived, resultAvailable, recoveryRequired, payment and delivery counts.

POST `/:id/archive` accepts `{acknowledge:true}`; POST `/:id/restore` accepts `{}`.
Archival preserves the task and purchase evidence. An active operation,
SIGNING/PENDING/UNKNOWN or a confirmed purchase without a validated delivered
result returns 409 TASK_UNRESOLVED. Archived tasks remain owner-readable but
cannot obtain a fresh quote, approval or execution. The 100-task cap counts
active tasks; archived history does not consume it. Restore and creation share
the same atomic owner capacity boundary.

GET `/:id`, creation and action calls return a public task snapshot directly.
Fields include separate `policy`,
`payment`, `delivery`, `events` and `result`. Owner filtering applies to every
lookup and mutation. The snapshot excludes signed payloads, raw report bodies,
private AI context and database fields. Every response has a server-generated
X-Request-ID, and errors expose `{error:{code,requestId}}`. Incoming request IDs
are not trusted. Expensive task operations have per-process/per-owner admission
limits (default 4/2); saturation returns 429 OPERATION_LIMIT_REACHED with
Retry-After: 1. This admission bound is per process, while budget reservations
must be durable and shared across replicas.

The optional server-only workspaceContext binds conversationId, planHash,
intentRevision, resourceId and mandateId/mandateVersion into the exact quote.
It is supplied only through the server task factory's fourth argument, remains
immutable after insertion and is never accepted in client Task JSON. Manual
tasks remain separate intents with the same payment gates.

`createApp` can mount owner-scoped workspace routes after common guards and
before static/404 through mountWorkspace(app,context). The context includes
auth, assertSession, now, respondTask, makeTask, config, store and withOperation.
Optional taskHooks.beforeClaim runs outside core mutations after fresh terms
and approval checks; beforeSign runs at the final signer boundary followed by
another authority/session check. observed runs after durable payment facts,
including reconciliation, before protected model/result release. Hook errors
stop further work without erasing saved chain facts or permitting re-signing.

Protected snapshot responses recheck the live session after awaited database or
gateway work. The result path checks again before model access and after model
completion before saving an answer. Logout/expiry does not erase independently
verified payment or delivery observations; it stops result release and requires
a fresh sign-in for subsequent recovery or inspection.

Health readiness combines payment configuration with a bounded read-only state
database query. A database outage returns `ready:false`, `databaseReady:false`
and `DATABASE_CONNECTION`; no upstream diagnostic is exposed. It is not proof
of a completed Devnet purchase. HTTP/scripted adapter tests are local integration evidence. Genuine
settlement requires a valid configured test-only payer, a supported facilitator,
chain verification and resource delivery. Optional live-model quality and
external data completeness require their own evidence.
