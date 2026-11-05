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
claimed by these local results. Account creation and key issuance are tracked
separately and still require the pending browser confirmation.
