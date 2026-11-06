# Workspace integration contracts

These are controller implementation contracts for this branch. They are not
an assertion of teammate approval or already-deployed APIs.

## Existing backend extension ports

`createApp` accepts optional `mountWorkspace(app, context)` and `taskHooks`.
Context provides `config, store, auth(req), assertSession(req, owner), now,
respondTask(req,res,task,owner,status), makeTask`. Mount before static/404 after
the existing Host/Origin/JSON guards. New APIs derive owner from the session and
recheck the session after awaits before returning private data.

Hooks are server-only and optional for existing adapters/tests:

- `beforeClaim({task, owner})`: after fresh quote/exact approval checks and
  before claiming SIGNING, durably reserve aggregate budget; failure stops signing.
- `beforeSign({task, owner})`: final current authority/reservation check after
  signer preparation; failure stops the actual signature.
- `observed({task, owner})`: after durable payment observations including
  reconciliation; update reservation facts independently of session/result release.

Task metadata `workspaceContext`, when present, is server-created and immutable:
`{conversationId, planHash, intentRevision, resourceId, mandateId, mandateVersion}`.
Include it in quote/approval binding and public snapshots. It is not accepted as
arbitrary client authority. Ordinary manual tasks remain valid separate intents;
global payer limits still apply at the execution hook.

Task lists are bounded summaries with nextCursor; selected-task GET returns full
result lazily. Creation accepts Idempotency-Key and rejects same-key changed
payload. Archive preserves purchases/proofs and owner isolation; unresolved
payments cannot be hidden as completed. Errors include a server request ID.

## AI port

`createPlanner({python, model, apiKey, timeoutMs})` returns:

- `refine({messages, intent, memories, catalog, nowIso})`
- `plan({messages, intent, memories, catalog, nowIso})`

Messages: `{id,role:'user'|'assistant',text}`. Intent fields:
`{purpose,wallet,windowStart,windowEnd,resourceId,missingFields}`. Memories are
owner-filtered explicit preference records; they cannot modify payment policy.
Catalog public IDs/attributes are server-created. Bound history, memory count,
input/output bytes, role count, calls/tokens and total process time. No tools,
arbitrary network destinations, payment flags, signer instructions or secrets
are part of model input/output. Output must be a strict validated object.

Refine output: `{status:'READY_TO_PLAN'|'CLARIFICATION_REQUIRED'|'UNSUPPORTED',
assistantText,intent,executionKind,modelVersion,promptVersion}`. Plan output:
`{status:'PROPOSED',summary,steps,limitations,executionKind,modelVersion,promptVersion}`,
with bounded roles/capabilities and registered resource IDs only. Missing model
configuration returns a fixed MODEL_NOT_CONFIGURED failure, never invented
inference. Root owns planHash/version/owner/approval, never the model.

## Persistence and public workspace APIs

Root implements a bounded owner-scoped record repository using the existing
SQLite/PG connection: `{id,kind,owner,revision,createdAt,updatedAt,data}` with
kind `conversation` or `memory`. CAS updates and stable cursor pages apply.
Private model inputs and merchant bodies never appear in audit summaries.

- GET/POST `/api/conversations`; GET `/api/conversations/:id`.
- POST `/:id/messages` with `{clientRequestId,expectedRevision,text}`.
- POST `/:id/plan` with `{clientRequestId,expectedRevision}`.
- POST `/:id/confirm` with `{expectedRevision,planHash,wallet,windowStart,windowEnd,mandateId?}`
  explicitly confirms scope and creates one idempotently linked task. Payment
  still requires the actual quote and separate exact approval.
- GET/POST `/api/memories`; DELETE `/api/memories/:id` with expectedRevision.
  User preferences require acknowledge:true and expiry. Outcomes are server-
  verified records, not model claims. Expired/deleted memory is not reused.
- GET `/api/catalog`, GET/POST `/api/mandates`, POST `/api/mandates/:id/revoke`,
  GET `/api/activity` and `/api/dashboard`: authenticated owner-scoped views.

## Catalog, mandates and budget ledger port

`createMandateService({store,config})` initializes its own schema-qualified
tables and exposes `catalog(), create(owner,input), list(owner), get(owner,id),
revoke(owner,id,expectedVersion), reserve(owner,task), assertReservation(owner,task),
observe(owner,task), dashboard(owner)`.

Mandate input: `{purpose,wallet,windowStart,windowEnd,budgetAtomic,
perPurchaseAtomic,expiresAt,maxExecutions,acknowledge:true}`. Only registered
wallet-transfers capability/Devnet/token/payee may be used. Versions and hashes
are server-generated. Limit expiry, counts, integer-string sizes and scope.
No task/mandate can authorize a replacement after an uncertain purchase.

Reserve is a durable idempotent unique owner/task claim. Under a DB transaction
and payer/day + mandate locks, enforce global payer daily cap (default existing
maxPaymentAtomic) and mandate `spent+held+requested <= limit`. Reserve before
the task signing claim; a crash retains the same held task reservation, reused
only for that same logical task/quote. UNKNOWN/SIGNING/PENDING keep funds held.
CONFIRMED moves once to SPENT; release only with conclusive safe-failure facts,
never based only on elapsed time, logout, HTTP error or process restart.
Final signer validation rechecks the current mandate/version/scope/expiry and
held reservation. Revocation blocks new signatures and preserves prior facts.

Ledger storage stays inside the existing private database and `floww_runtime`
schema. No runtime grant, database CREATE privilege, new signing path, automatic
payment approval or free-form model-selected resource URL is introduced.
