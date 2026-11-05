# Backend independent review — 2026-11-05

Reviewer: a different implementation worker from the author of the backend
app/policy. This review covers `service/app.mjs`, `main.mjs`, `policy.mjs`, and
the controller's `config.mjs`, SQLite `store.mjs`, and `network.mjs`.
It does **not** independently review this reviewer's own provider, AI bridge,
or PostgreSQL adapter. Those changes require another reviewer.

Status: all three findings below were corrected and independently rechecked.
No unresolved P1/P2 finding remains in this reviewed scope. No cloud writes, external payment,
signature, secret read, deployment or Git mutation was performed by this review.

## P1 — Revoked session can receive a new protected result (resolved)

At the reviewed source, `applyOutcome` awaits `ai.consume`, persists its result,
and returns `publicTask` without a fresh session check. `recover` and `reconcile`
also return task snapshots after awaited gateway operations without checking that
the initiating session is still valid. Owner row selection does not establish
that a revoked or expired session remains authorized to receive the response.

Reproduction used a real loopback HTTP server and genuine generated Ed25519
wallet sign-in, with explicitly scripted gateway and AI outputs. The AI consume
hook sent `POST /api/auth/logout` for the initiating session before returning.
The original execute request then returned:

```json
{"executeStatus":200,"sessionStatus":401,"protectedResultReleased":true}
```

Preserve independently observed chain/delivery facts, but check the session after
awaited gateway/AI work and before saving/releasing a new protected result.
Thread the authenticated request or a session validator into `applyOutcome`;
return 401 when the session was revoked/expired. Add regressions for logout and
expiry during gateway/AI work, including recovery/reconciliation responses.

## P2 — Health readiness ignores the durable store (resolved)

`GET /api/health` only consults gateway configuration/key readiness. Replacing
the store with an unavailable backend whose methods throw `STATE_UNAVAILABLE`
still produced this real HTTP response when gateway configuration was ready:

```json
{"http":200,"ready":true,"missing":[]}
```

A managed database can become unavailable after startup; such an outage would
be invisible to health monitoring. Separate liveness and configuration readiness
from dependency readiness. At minimum, require a bounded durable-store ping
before `ready:true`. Evaluate RPC-genesis/facilitator connectivity separately
with bounded, cached probes so readiness monitoring remains low load.

## P2 — RPC and report work lack caller cancellation/total deadline (resolved)

`createRpc` replaces caller cancellation with its own per-call timeout and does
not accept/propagate the provider's third `{signal}` argument. A deterministic
transport probe passed an already-aborted caller signal and observed:

```json
{"fetchCalled":true,"returnedResult":"accepted","forwardedCallerSignal":false,"transportSignalAborted":false}
```

The merchant also calls `reportProvider` without a request/deadline signal.
Consequently a bounded page can still perform many sequential per-RPC timeouts
after the purchasing client times out. The HTTP server's request timeout is not
a total application-work deadline.

Compose the caller signal with each transport deadline, provide a total report
deadline and response-close cancellation, and pass that signal through the
provider. Cancellation before settlement should stop stale report work. Once
settlement begins, retain durable observation/bookkeeping even if the client
disconnects; do not create a replacement payment.

## Checks that passed

`node --test test/app.test.mjs test/policy.test.mjs test/store.test.mjs`
passed **17/17** checks. This reproduced owner isolation, one-use signed login,
Host/Origin checks, exact quote approval, over-budget/recipient DENY, quote
substitution and expiry rejection, concurrent-execute exclusion, UNKNOWN
replacement refusal, saved-proof recovery, revocation before signing and
broadcast, monotonic confirmation, stale-authority result rejection, private
state redaction, SQLite recovery/rollback and unsafe-path rejection.

The three probes above add failure conditions absent from that existing test
set. They use actual local HTTP/process behavior where stated and scripted
payment/AI responses; they do not establish live Devnet settlement or browser
wallet acceptance. Remote-listen configuration was being added by the controller
and needs a final review after it lands.

## Remediation verification

The original independent HTTP probe was replayed after the backend fix. The
new result and chain/delivery facts were checked separately:

| Probe | HTTP | Result released / stored | Persisted payment / delivery |
| --- | --- | --- | --- |
| Logout during AI await | 401 | false / false | CONFIRMED / COMPLETED |
| Session expires during AI await | 401 | false / false | CONFIRMED / COMPLETED |
| Logout during gateway await | 401 | false / false | CONFIRMED / COMPLETED; AI calls = 0 |

The backend now rechecks the live session before AI, after AI before result
persistence, and immediately before protected task/list responses. Expiry is
also rechecked against the current clock after the session database await.
Confirmed chain facts are retained rather than relabelled as failure.

The unavailable-database health probe now returns HTTP 200 with `ready:false`,
`databaseReady:false` and `DATABASE_CONNECTION`. The durable-store check has a
bounded 2.5-second readiness wait. Health readiness still does not claim a
completed live-model or Devnet-payment test.

The original already-aborted RPC probe now observes **zero fetch calls** and a
fixed `RPC_UNAVAILABLE` diagnostic. RPC transport composes the caller signal
with its per-call timeout and rechecks it after reading the body. The merchant
passes a request/response-close signal into pre-settlement report collection,
enforces its total request deadline, and removes that cancellation only at the
durable settlement claim. Tests prove pre-settlement disconnect/deadline prevent
settlement while disconnect after settlement starts preserves the original
durable outcome for identical-proof recovery. The provider's own whole-report
deadline change was authored by this reviewer and remains outside independent
coverage here; reciprocal review was requested from the backend worker.

Fresh execution:

```text
node --test test/app.test.mjs test/policy.test.mjs test/store.test.mjs
25 passed; 0 failed; 0 skipped

node --test test/network.test.mjs test/config.test.mjs test/app.test.mjs \
  test/policy.test.mjs test/store.test.mjs test/x402.test.mjs
55 passed; 0 failed; 0 skipped
```

The expanded SDK suite was executed to verify cancellation integration; this
report is not a separate complete audit of the SDK module. Remote configuration
was also checked: public bind requires explicit remote mode, exact HTTPS origin
and persistent DATABASE_URL; HTTP/loopback origin, missing DB and implicit public
bind are rejected. Accepted remote config retains Secure `__Host-` session
cookies. Host/Origin checks are still enforced; no broad proxy-header trust or
CORS exception was introduced.

## Final reviewed source hashes

| Source | SHA-256 |
| --- | --- |
| service/app.mjs | 1d99e3c8d0ae0fc13ab99abf54ff4fc070d5fcdfde7251e4ea71732201653f66 |
| service/main.mjs | 46804f3068c278ef3fbb34dd3c8af8337a3dbdb5f42107b634a4623ff3211871 |
| service/policy.mjs | f8a427efc9c1912c0ed875030033582af4f5db14591d0794253cea500ca2a6a2 |
| service/config.mjs | 2db6777b279ec197babb7f8c079f262c937e3e1c9cb0c6fa5763db618e9f9913 |
| service/store.mjs | 74d97e041d83d6f394856be92f19321cbfd67e1e7fabda6c982c23973e2d7e7e |
| service/network.mjs | 3aafe38c786e1e7de138e4dae0d3401a8d67b2ba336149c4d71ab654bf153275 |
| service/x402.mjs (cancellation integration only) | afb5caa308b79475a0cde4985fcbac4d1238f4729f5cda407debe8406a3f659c |

## Initial reviewed source hashes

| Source | SHA-256 |
| --- | --- |
| service/app.mjs | 9b4a165c8ebc4ca12fb13c3ec8dc558a96a9f9f1702195afbcb3673c9e0c762e |
| service/main.mjs | 46804f3068c278ef3fbb34dd3c8af8337a3dbdb5f42107b634a4623ff3211871 |
| service/policy.mjs | f8a427efc9c1912c0ed875030033582af4f5db14591d0794253cea500ca2a6a2 |
| service/config.mjs | e51578d56f441906096ec5ae7d9bc9576e5b0605ab9fc0421988b7d5d1df2845 |
| service/store.mjs | 74d97e041d83d6f394856be92f19321cbfd67e1e7fabda6c982c23973e2d7e7e |
| service/network.mjs | 6b90403617c541b7896a5d2b8fbec41ae8a7c9fe9b5baced1bf0a49d98e40d7e |
