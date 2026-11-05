# Solana integration takeover — 2026-11-05

Geondong asked this controller to implement the remaining work after reviewing
the shared repositories and current team discussion. This is a new
integration service on top of AI source `f6d3c0106f0f8506c436876a771175a3009bd4d0`;
it does not alter the legacy EVM services or claim teammate agreement.

## Implementation

- Node 22.13+ ESM service, Express and pinned official x402 V2 exact/SVM SDK.
- Local SQLite or isolated-schema PostgreSQL persists wallet authentication challenges, opaque sessions, tasks,
  immutable quotes/approvals, purchase claims, payment/delivery state and events.
- Sign-in uses a one-use, origin-bound Ed25519 wallet challenge. Session cookies
  are HttpOnly/SameSite=Strict; state-changing calls require the configured Origin.
- One configured report merchant and Devnet network only. No caller-supplied URL,
  facilitator, RPC, chain, mint, signing key or arbitrary recipient is trusted.
- A user chooses a wallet transfer report and an explicit window of at most seven
  days, obtains a real HTTP 402 quote, then explicitly approves the exact tuple,
  resource, cap and expiration. The server's configured **Devnet service wallet**
  pays; the login wallet is identity, not an asserted source of payment funds.
- The final signing boundary revalidates owner, approval, quote, expiry, budget
  and payment tuple. An atomic durable claim precedes signing. Uncertain signing
  or payment stays UNKNOWN and cannot generate a replacement transaction.
- Confirmation and resource delivery are independent. Recovery uses the saved
  original signed payload only; no new signing on retry. Persist payloads in the
  private local database, never API responses, model input, logs or evidence.
- The merchant uses the same official SDK and serves a bounded report derived
  from actual Solana RPC responses. Unsupported/omitted transactions keep report
  coverage partial. No invented transactions, balances or full-history claims.
- Existing Python AI validators/report output remain authoritative; a bounded
  subprocess adapter calls them. Optional model configuration stays server-only.
- A responsive same-origin browser UI handles wallet login, report request,
  quote/approval, execution, timeline, recovery and result inspection.

## Service contract (new implementation, not an inherited team agreement)

`GET /api/health`, `GET /api/session`, `POST /api/auth/challenge`,
`POST /api/auth/verify`, `POST /api/auth/logout`, `GET/POST /api/tasks`,
`GET /api/tasks/:id`, and owner-only POST actions `quote`, `approve`, `execute`,
`reconcile`, `recover`. Task create body: `purpose`, `wallet`, `windowStart`,
`windowEnd`. Approval body binds `quoteHash`, `budgetAtomic`, `expiresAt` and
`acknowledge: true`; payee/mint/network and the payer are visible in the quote.

UI task snapshots expose `id`, `purpose`, `wallet`, `windowStart`, `windowEnd`,
`policy`, `payment`, `delivery`, `quote`, `approval`, `transaction`, `events`,
`result`, `reasonCode`, `nextAction`. They never expose proof headers or secrets.
Payment: NOT_STARTED / SIGNING / PENDING / UNKNOWN / CONFIRMED / FAILED.
Delivery: NOT_STARTED / PENDING / COMPLETED / FAILED. Policy: PENDING / ALLOW / DENY.

## Ownership and checks

- Controller: package/lock/config, auth, SQLite, API/policy, UI/integration and CI.
- SDK worker: `service/x402.mjs` and `test/x402.test.mjs` only; SDK compatibility,
  quote parsing, signing, redemption, reconciliation and protected merchant.
- Data/AI worker: `service/provider.mjs`, `service/ai.mjs`,
  `reference/ai_baseline/integration_cli.py`, their targeted tests only.
- Independent reviewer: read-only review after integration, findings before
  release. Workers do not change Git refs, push/merge, publish or send messages.
- Preserve all 137 existing checks. Add real HTTP/persistence/auth/negative and
  restart/concurrency tests, SDK protocol tests, and browser checks. Scripted
  transport tests are not Devnet settlement evidence.

Geondong subsequently requested a fresh Infisical setup, OpenAI key, database
and deployment resources. Account setup is a separate workstream: the specific
browser confirmation for irreversible cleanup, new credentials and account
terms is pending. Deployment files are prepared, not evidence of a running
cloud service. Remote startup requires an explicit mode, an HTTPS exact origin
and PostgreSQL; it refuses disposable container-local SQLite. Existing EVM
deployments and databases remain separate.

No mainnet payment, paid upgrade, team message, external documentation
publication or legacy/shared DB migration is authorized by this implementation.
Live Devnet signing is opt-in and requires an explicitly configured test-only
service wallet; missing configuration remains a readiness failure, never
synthetic success.
