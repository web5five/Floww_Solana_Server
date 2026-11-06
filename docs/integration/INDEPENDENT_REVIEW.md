# Independent integration review — 2026-11-05

Reviewer: backend integration worker, independently reviewing the SDK, data/AI,
PostgreSQL and controller-authored modules listed below. This reviewer authored
API/policy/main and therefore does **not** independently approve those modules.

Status at the recorded source hashes: **four concrete findings fixed and
regression-checked; no remaining blocking finding in this review scope.** This
is a code/component review, not teammate approval or live-payment acceptance.

## Findings and resolution

| Priority | Finding / reproduction | Resolution and current location |
| --- | --- | --- |
| P1 | The SDK compared `getGenesisHash` against the shortened CAIP-2 reference. One real read-only public Devnet RPC call returned `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`, so genuine Devnet signing/reconciliation would be rejected. No signature or payment was performed. | Fixed in `service/x402.mjs:27`, with checks before signing (`:330`) and reconciliation (`:368`). `test/x402.test.mjs:367` rejects the shortened reference. |
| P2 | Reconciliation treated absent or malformed transaction `meta.err` as proven failure. Missing evidence must remain UNKNOWN. | Fixed in `service/x402.mjs:381`: metadata and its `err` member are required, and only concrete non-null failure evidence produces FAILED. `test/x402.test.mjs:376` covers missing and malformed metadata. |
| P1 | Merchant cancellation listeners/timer were cleared before awaiting asynchronous durable receipt claims. Disconnect/deadline during a PostgreSQL claim could therefore proceed to settlement after that await. The pending receipt write had the same async boundary. | Fixed in `service/x402.mjs:516-525`: cancellation remains active through both persistence awaits, with a guard after each and cleanup directly before settlement. Gated disconnect regressions at `test/x402.test.mjs:441` and `:458` produce zero settlement calls. Disconnect after settlement begins still preserves the durable original outcome. A cancelled claim remains conservatively blocked. |
| P2 | Remote origin validation rejected only exact loopback spellings. `https://127.0.0.2` and `https://[::ffff:127.0.0.1]` were accepted with remote mode and a database URL. | Fixed in `service/config.mjs:6-14` and `:59` using Node BlockList for 127/8 and IPv6 loopback, including mapped addresses and localhost suffixes. `test/config.test.mjs:17` covers eight aliases. Independent repro now rejects both original URLs and accepts an ordinary HTTPS origin. |

The respective source owners made these fixes. This reviewer edited only this
review document during the reciprocal review, and reported findings when found.

## Inspected safety boundaries

- SDK codecs/schema, exact Devnet requirements and the full genesis check remain
  in the path. Merchant origin, resource/window, mint, recipient, amount, fee
  payer and memo are constrained before signing. Version-0 instructions are
  limited to bounded compute settings, one exact TransferChecked and the memo;
  incoming payer signatures are cryptographically verified.
- The final signer callback follows RPC preparation. Signing deadlines prevent
  a late SDK RPC from signing after cancellation. A partially signed payload is
  not presented as a transaction identifier. Reconciliation requires the saved
  original message, matching chain transaction and successful confirmed status;
  HTTP/facilitator success alone cannot prove payment. This trust model uses
  the configured RPC, not an offline proof of consensus.
- Merchant receipt claims are atomic. Identical-proof cached delivery and
  lost-receipt recovery cannot intentionally settle the proof twice. Missing
  chain evidence and claim-only crash windows stay UNKNOWN/PENDING. Before
  settlement, disconnect/deadline cancels report work and is checked after
  durable awaits. Once settlement begins, bookkeeping survives disconnect.
- Provider amounts remain exact positive u64 base units. Ambiguous token owner
  evidence and unsupported instructions are omitted. Reports are explicitly
  partial. Pagination completeness describes the bounded wallet query, not all
  token-account history. One total report deadline and the caller signal reach
  each RPC; per-RPC deadlines still apply. Real loopback HTTP tests exercise
  sequential deadline exhaustion and active cancellation.
- The AI subprocess uses a minimized environment, bounded input/output, total
  kill deadline and discarded diagnostics. Scope/freshness, authorization,
  UNKNOWN/payment/delivery and report validators remain in the Python path.
  Explicit resource selection does not claim a live model inference.
- SQLite uses private files, session-token digests, owner-scoped operations and
  atomic mutation. PostgreSQL uses checked-out transactions, row/advisory locks,
  one-use challenges, owner constraints, bounded pool/query settings and verified
  TLS for remote hosts. Opening another pool preserves live leases. Expired
  signing leases become UNKNOWN without losing the original proof/attempt.
- Remote mode explicitly requires HTTPS, a nonloopback origin and DATABASE_URL;
  local mode retains loopback binding. HTTPS session cookies remain Secure and
  host-only. Network helpers reject redirects, bound response bytes, propagate
  caller cancellation and return fixed diagnostics.
- The container copies an allowlisted source/dependency set, runs as the node
  user and contains no cloud credentials in the reviewed source. The Render
  blueprint disables automatic deploys and payment opt-in. Its manual deploy
  value matches the [official Blueprint specification](https://render.com/docs/blueprint-spec#autodeploytrigger).
  This is static preparation; no image build or cloud deployment was performed
  by this reviewer.
- CI pins checkout/setup-node/setup-python to verified official repository tag
  SHAs, installs PostgreSQL binaries and sets FLOWW_REQUIRE_POSTGRES_TESTS=true.
  Missing binaries fail that job rather than silently skipping database tests.
  The syntax/whitespace/NFC checker stays inside the integration source trees.

## Executed checks

Independent local environment: Node 25.8.1 / Python 3.14.6 / PostgreSQL 16.13.
The prepared CI specifies Node 24 / Python 3.13; no hosted CI result is claimed
by this reviewer.

```text
node --test test/x402.test.mjs test/provider.test.mjs test/ai.test.mjs test/config.test.mjs test/network.test.mjs
61 passed, 0 failed, 0 skipped

FLOWW_REQUIRE_POSTGRES_TESTS=true node --test test/postgres-store.test.mjs
14 passed, 0 failed, 0 skipped (actual isolated PostgreSQL)

PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=reference python3 -m unittest discover -s reference/tests -p test_integration_cli.py -v
9 passed
```

The PostgreSQL test owned only its temporary cluster, and stopped/removed it
successfully. A separate controlled run removed PostgreSQL binaries from the
child process PATH while keeping the mandatory flag: it returned nonzero with
zero skips as intended. The Node checks use real SDK construction and loopback
HTTP, scripted facilitator/RPC observations, real Python subprocesses, durable
concurrency, lost receipts, altered signatures and cancellation/deadline cases.

No live external payment, live model request, user-wallet approval, cloud
resource creation or deployment was performed by this reviewer. The single
external RPC probe only read the public Devnet genesis. Browser/API acceptance
and full release-suite results belong to the controller and other reviewer.

## Reviewed source SHA-256

| File | SHA-256 |
| --- | --- |
| `service/x402.mjs` | `8a74403a02f75cfa3c1c4dc10b5dea80afa9fcf9775106c34c8200436ff69ffa` |
| `service/provider.mjs` | `bb609b99b0e55b144578132423991b730a7b7c3a2559a7bd5896c16b2567bb8e` |
| `service/ai.mjs` | `e4c94e474325faabbdb7c1bb42869652d2b266a796b41ba381a71e08bf30cf5d` |
| `reference/ai_baseline/integration_cli.py` | `a6678ea557b6ffabc0bd6027c12de559f0b96d321345b1a4b8be7dea55141b5e` |
| `service/config.mjs` | `eb5641507df6bd96e8b6833cc68fc11549e715501513e63a2d5a6b8ebfc8d41b` |
| `service/store.mjs` | `74d97e041d83d6f394856be92f19321cbfd67e1e7fabda6c982c23973e2d7e7e` |
| `service/postgres-store.mjs` | `57e17e81facfd634100bec1d8939850db8a28f95c37c8d00b20ae065375963da` |
| `service/network.mjs` | `3aafe38c786e1e7de138e4dae0d3401a8d67b2ba336149c4d71ab654bf153275` |
| `scripts/check.mjs` | `58459325f1270359a6393d6c30661837c1a225204bd437053186a6b82b326883` |
| `Dockerfile` | `d327baead192452ffeda7b752323c8d9ba4f63e10687966d7054cb980378a591` |
| `.dockerignore` | `d0af99bba68d81aba447ed11b8810850412593842e1cc7936fe76108d1d56c4e` |
| `render.yaml` | `e02d21331e35d8f97edfb9e2db2abf2754e6e3bff84585bb35151f9b128e3225` |
| `.github/workflows/solana-runtime.yml` | `9d788260b0245441bd8ae212eb6c9b0c8b58ed509a3e63ea464d0a3bca7cabd3` |
| `test/x402.test.mjs` | `3cdff0ba2fd94b1b6e56cf83ae1d171c96b21c410f3467e2b27d43f16d32b986` |
| `test/provider.test.mjs` | `c01c7fd233f84cd7a20d90fa7fa5d9889551e060ea1a6db3db871fe2a98b32da` |
| `test/ai.test.mjs` | `a2adb4af784c5bcd76d2d80e26b7a2d8c414738064305e80fe1e776fad061dce` |
| `test/config.test.mjs` | `05bbe88e181b9beb758afbb08a442c306946b4ef1486c3b094edfe7c132d55a9` |
| `test/network.test.mjs` | `e17f9e4f2b8e1e460d35e82c11cd7de0c124bff6280da9956a4f3cef9f81f3d3` |
| `test/postgres-store.test.mjs` | `92790bd449d08606498c39b9ed6b80a7c1072373bdc86a0f568e03f0991537bd` |
| `reference/tests/test_integration_cli.py` | `6fa36dcdd88b87cab50a9c55836e4b4d43b8ce48d37db508a1efe769e16b6cb4` |

Any material later change needs its own review. Report coverage remains partial,
and lost-signature reconciliation searches at most 25 recent payer transactions.
Failure to find the original transaction is not proof of nonpayment.

## Follow-up — 2026-11-06: bounded PostgreSQL CA support

Baseline: commit `2df36d80b62c06d969f566a5264533fabec211f0`. This follow-up
independently reviewed only the two-file delta below. The earlier source table
records the prior review snapshot; these hashes record the CA follow-up.

Result: **no unresolved P1/P2 finding in this delta.**

- CA input is validated before pool creation: at most 65,536 UTF-8 bytes, one
  canonical-base64 PEM certificate, no bundles/private keys/trailing DER, with
  the X509 CA flag and a currently valid certificate period. Invalid input
  becomes a fixed INVALID_DATABASE_CA error without echoing the supplied value.
- Undefined, null and an empty string preserve the previous trust behavior.
  Explicit CA configuration sets only that CA and rejectUnauthorized=true;
  URL sslrootcert/sslcert/sslkey/ssl/rejectUnauthorized values are not forwarded.
  Insecure sslmode values are rejected. No hostname verification override is
  introduced. An explicit CA forces TLS even for loopback connections.
- The revised local test fixture creates its own short-lived CA/server keys,
  enables TLS on its disposable PostgreSQL cluster, verifies an actual encrypted
  connection and refuses an unrelated CA. The fixture also checks expired and
  non-CA certificates, malformed/oversized/bundled input, pre-pool validation,
  preserved default roots and connection-string override attempts.

Executed independently:

```text
FLOWW_REQUIRE_POSTGRES_TESTS=true node --test test/postgres-store.test.mjs
19 passed, 0 failed, 0 skipped
```

The owned `/tmp/floww-pg-bGvaK7` cluster was stopped and removed successfully.
No downloaded CA, private credential file, environment file or cloud database
was accessed. Controller-owned config/main/environment wiring and actual
Supabase acceptance are outside this follow-up scope.

| Follow-up file | SHA-256 |
| --- | --- |
| `service/postgres-store.mjs` | `e218a26c8d431cf7e891a20263ab1e569dd1339d9441ae5977b97193793e429f` |
| `test/postgres-store.test.mjs` | `4373368d9aae505911641e8184698cd8e968ca1add999a484b8eb4ce677e3c7e` |

## Follow-up — 2026-11-06: pre-provisioned PostgreSQL schema

Scope: the subsequent startup-only delta in service/postgres-store.mjs and its
real database regression, following the CA review above. **No unresolved P1/P2
finding in this delta.**

The existing advisory transaction lock remains in place. Startup queries
pg_catalog.pg_namespace for the fixed floww_runtime name, creates the schema
only when absent, then initializes explicitly schema-qualified tables/indexes.
No GRANT, role change, database privilege escalation or public-schema fallback
was introduced in runtime code.

The real regression provisions an isolated test database and a LOGIN-only role
with no database CREATE or elevated role flags. Missing-schema startup returns
fixed STATE_UNAVAILABLE/503. After test administration creates an admin-owned
schema and grants only USAGE/CREATE there, task mutation, reopening and session
challenge/authentication work. The schema remains admin-owned; creating another
schema or a public table still fails with PostgreSQL 42501. Generated roles and
databases exist only in the owned disposable cluster.

Executed independently:

```text
FLOWW_REQUIRE_POSTGRES_TESTS=true node --test test/postgres-store.test.mjs
20 passed, 0 failed, 0 skipped
```

The owned `/tmp/floww-pg-nJ02IL` TLS cluster was stopped and removed successfully.
Both changed JavaScript files also passed node --check. No cloud database,
credential/environment file, downloaded CA or stored private path was accessed.

| Follow-up file | SHA-256 |
| --- | --- |
| `service/postgres-store.mjs` | `3f4973175ca921279d829e03ad0a3aedf7373a8a37dd1f2775240b2b31ac8afc` |
| `test/postgres-store.test.mjs` | `3d2c9923e5f6c84d3bf98c880fefa76bc02c2c59cebf306dc233adc03242bd6d` |
