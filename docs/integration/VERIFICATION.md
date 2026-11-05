# Integration verification — 2026-11-05

Controller checks ran on Node 25.8.1, Python 3.13.3 and PostgreSQL 16.13.
This is local implementation evidence, separate from account provisioning and
external runtime acceptance.

| Check | Observed result |
| --- | --- |
| `FLOWW_REQUIRE_POSTGRES_TESTS=true npm test` | 100 passed, 0 failed, 0 skipped |
| Python unittest discovery under `reference/tests` | 146 passed, including the unchanged 137-check baseline |
| `npm run check` | Integration source syntax, whitespace and NFC filenames passed |
| Isolated PostgreSQL cluster | 14 real DB tests; own temporary cluster stopped and removed |
| Keyless local process | Started at `http://127.0.0.1:4318` using a private SQLite file |
| Public UI | HTTP 200, no redirect; desktop and 390px mobile viewport inspected |
| Mobile layout | Document width equals visible client width (375px after scrollbar); no horizontal overflow |
| Wallet missing | Visible Phantom-not-found message; task creation remains disabled |
| Anonymous tasks/session | HTTP 401 for both |
| Different-Origin task mutation | HTTP 403, `ORIGIN_REQUIRED` |
| Raw HTTP unexpected Host | HTTP 421, `UNEXPECTED_HOST` |
| Health without execution setup | HTTP 200, `databaseReady:true`, `ready:false`, `modelConfigured:false`, explicit missing configuration |

The Node suite includes actual SDK transaction construction with ephemeral test
keys and scripted facilitator/chain responses. It covers exact quote binding,
owner/origin/session boundaries, final authorization before signing, concurrent
claims, UNKNOWN/restart preservation, saved-proof recovery, late-session
revocation, report cancellation (including asynchronous claim/pending writes),
remote-origin loopback aliases, safe rendering and private-state redaction.
It does not broadcast an external transaction.

The initial fetch-based Host probe was inconclusive because the client did not
send the requested Host override. A subsequent `node:http` request explicitly
sent the different Host and returned 421; the table records that actual check.

Independent reviews are recorded in [SDK/data review](INDEPENDENT_REVIEW.md) and
[backend review](BACKEND_INDEPENDENT_REVIEW.md), with source hashes and concrete
findings/remediation. No teammate review, GitHub CI result, cloud image build,
live model answer, installed-wallet browser login or actual Devnet settlement is
claimed by the November 5 local results. Account provisioning and later
acceptance are tracked separately below.

## November 6 managed-resource acceptance

- The final runtime suite passed **106/106**, with zero failures/skips; Python's
  unchanged 146 checks remain separately recorded. Twenty real PostgreSQL checks
  include explicit TLS CA trust and a login without database-level CREATE.
- A real Responses API request using the fresh restricted key returned HTTP 200
  with the expected output: 13 input tokens, seven output tokens, no reasoning
  tokens, `store:false`. This was a connectivity check, not a paid-report E2E.
- Twelve settings were saved in the new Infisical Development environment,
  exported back through its UI, privately compared and found identical.
- The server started with that readback and the new managed DB's limited login.
  The provider-issued CA and verified TLS were required. Page/health returned
  200; anonymous tasks/session returned 401. Health reported database/model
  configured, payments disabled and explicit missing merchant/payer settings.
- Only the new `floww_runtime` schema was initialized, containing challenges,
  sessions, tasks and merchant receipts. No legacy DB was modified. The local
  acceptance process was closed after the checks.
- Render registration succeeded. No Render service, hosted image build, public
  release, installed-wallet login or actual Devnet settlement is claimed here.
