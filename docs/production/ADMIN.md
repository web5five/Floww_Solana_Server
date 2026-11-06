# Administrator operations console

This console implements the separate administrator requirement from the
September 30, 09:52:57 KST user request (source 77127): identify available data,
generate a design image, then build dashboard, logs and graphs. Personal owner
Activity is a different surface. The implementation and acceptance record must
not treat either a design image or a role-denied page as a working administrator
journey.

## Operator purpose and design

The first question is where to investigate: uncertain payment, confirmed but
undelivered data, or delivered data awaiting an answer. Keep those facts separate
through authorization, payment, delivery and result. This follows the archived
product direction in [EXPERIENCE.md](EXPERIENCE.md); an analytics or revenue grid
is not Floww's entire purpose.

The controller generated a Korean desktop reference using the built-in
image-generation tool after inspecting current telemetry and persisted state.
The local evidence includes `관리_대시보드_시안.png` and its exact prompt/provenance
in `디자인_근거.json`. The implementation must preserve the actual reviewed SVG
and populate real projections. The image's illustrative date, unavailable values
and category semantics are not runtime facts or source data.

Use a separate role-gated admin surface in the existing shell, with overview,
HTTP request records and retained Task events. Preserve the six consumer pages,
their unsent draft, exact financial consent and shared Task. Put attention before
detail, readable source/freshness captions beside metrics, and manual refresh
before dense operational tables. All charts need labelled values and a readable
text/table alternative; status cannot depend on color alone.

## Available data and meaning

| Source | Actual available facts | Coverage and limits |
| --- | --- | --- |
| HTTP telemetry | Fixed method/route/status classes, completion/abort counts, latency histogram, UTC minute buckets and sanitized observations | Current runtime only; 60 retained minutes and latest 200 observations. Includes probes and administrator reads. This is HTTP traffic, not business demand, model success or Task creation. Restart resets it. |
| Persisted Tasks | Current policy/payment/delivery distributions, report availability, active/archived totals and exact joint-state attention counts | All stored Task states at the captured snapshot; not historical conversion or failure rates. Invalid/unrecognized enums use OTHER. |
| Task events | Fixed event/reason/time, a redacted Task reference and separately labelled current Task states | At most 100 retained events per Task; newest retained events are not an immutable all-history audit archive. The event itself has no historical policy/payment/delivery snapshot. No private body or full Task is returned. |
| Model admission | Up to seven UTC days of indexed global admitted-role-call counters | Admission/reservation, not vendor token billing, successful responses, end-user requests or monetary cost. |
| Execution ledger | Global ledger held/observed execution counts by UTC day | Existing ledger coverage. Asset/network are not part of the historical bucket key, so unattributed atomic amounts cannot be presented as current USDC, revenue or comparable currency totals. |

Attention counts require the actual joint state, not subtraction of unrelated
marginals: unresolved payments are SIGNING/PENDING/UNKNOWN;
`confirmedUndelivered` requires CONFIRMED payment and delivery other than
COMPLETED; `deliveredWithoutReport` requires CONFIRMED payment, COMPLETED
delivery and no actual result answer. An overlapping attention list cannot be
drawn as a mutually exclusive donut. Payment and delivery distributions have
their own enum definitions and denominators.

A successful query with no matching rows can prove zero. A missing capability,
query timeout, source failure or malformed/unsafe count cannot. Preserve those
differences, source-specific timestamps and cache/window coverage in the UI.

## Authorization and read contract

`FLOWW_ADMIN_WALLETS` is an explicit server-only, validated list of at most five
distinct addresses, frozen for the runtime lifetime. Its default is empty. There
is no first-owner, payer, client-toggle, test-wallet or browser-storage shortcut.
Implementation does not add a real administrator or grant wider signer powers.

Use the existing exact-origin wallet session. Every administrator request must
authenticate and check membership before cache/source access, then repeat the
session/membership check after awaited work and before releasing data. Respect
draining at both boundaries. Guest requests return 401; authenticated nonmembers
or empty configuration return 403. Cache entries never bypass authorization.

- `GET /api/admin/access`: authorized read role and session expiry only.
- `GET /api/admin/overview`: versioned independent runtime, Task, admission and
  execution source envelopes with status, captured time, scope and fixed failure
  code. An unavailable source does not replace healthy sources with false zero.
- `GET /api/admin/requests?limit=25`: bounded sanitized process observations,
  retained-window metadata and hasMore; limit 1–100.
- `GET /api/admin/events?limit=25`: bounded retained Task events with short
  server-derived Task references and fixed enum fields; limit 1–50. Any attached
  policy/payment/delivery describes the current parent Task at source capture,
  not its state at the event timestamp. The DTO and UI must expose that scope.

No admin mutation, arbitrary SQL/filter, payment retry, signing, refund, role
grant, token or private-content endpoint is introduced. Data excludes wallets,
owners, purposes, conversations, memories, reports, proofs, credentials, URLs and
raw stdout/stderr. Event/reason codes use fixed allowlists with OTHER. Request
IDs remain bounded correlation identifiers, not session tokens.

The design applies [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)
on least privilege, default denial and per-request checks, and
[OWASP logging guidance](https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html)
on sensitive-field exclusion, access restrictions and failure isolation. This
is an engineering control mapping, not a security certification.

## Resource and client boundaries

Use raw read-only projections. Ordinary Store reads can normalize historical
payment state, so they are unsuitable for a global read-only audit projection.
No migration/index or managed database configuration change is part of this
console. Global scans/sorts lack a suitable creation-time index; LIMIT alone
does not bound their work.

The database source needs a shared five-second cache and single flight, one
existing-pool client, read-only PostgreSQL transaction, per-statement 750ms
timeout and a two-second database-reader observation budget. Authentication and
session reads can add time; this is not an end-to-end HTTP latency guarantee.
Keep real pending work under lifecycle tracking until rollback/release completes;
an observation timeout
cannot start replacement work or force another database session to terminate.
For file SQLite, isolate fixed read-only SQL in an owned worker using actual
store-path metadata. Unknown/in-memory sources are explicitly unavailable.
Do not assume worker termination instantly interrupts synchronous native SQL;
retain the flight until the worker actually exits.

The browser must reauthorize entry/refresh, fence late responses by
owner/session/route generation and clear administrative payloads and DOM on
exit, expiry, denial or owner/session change. Same-wallet renewal is a new
session context. Language changes update authored leaves without refetching or
mutating source records. No private admin cache belongs in URL/history/local
storage, and ordinary navigation cannot initiate a financial operation.

## Acceptance and live enablement

Require real PostgreSQL and file-SQLite projections, known counts/event ordering,
strict redaction, default-empty and ordinary-owner denial, forged role/query
rejection, expiry/logout/drain races, timeouts/single-flight and unchanged
financial records. Independently review the exact source and required CI.

Native desktop/390px KO/EN checks must cover usable charts/tables, freshness and
partial failure, manual refresh, owner/route cleanup and a return to the original
consumer draft/Task. Distinguish scripted identities/display data from actual
authorized operator access. Image-to-code comparison requires the rendered
implementation, not just a successful HTML test.

Actual activation still requires an explicitly designated administrator address
on the approved runtime and real wallet acceptance. Do not infer that choice
from a data owner, payer or fixture. The current work prepares and verifies the
complete reviewable result before any live grant decision.
