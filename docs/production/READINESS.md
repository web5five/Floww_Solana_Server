# Production-level quality for the hackathon

The user clarified on November6: this is a hackathon entry whose quality should
reach production level. The objective is a convincing, usable and technically
sound product, with real behavior and evidence. PR #10 / main `1a3f964` is the
starting comparison checkpoint. Each iteration needs a measured before/after
result and exact-source review, not a new feature count.
The exact-source comparison is [COMPARISON.md](COMPARISON.md).
The original submission-day requests and their product acceptance mapping are
in [USER_INTENT.md](USER_INTENT.md). They prioritize an integrated, usable demo,
coherent KO/EN presentation and real user journeys over generic infrastructure.

## Acceptance standard

For this entry, production-level quality means the supported journey feels
complete and works correctly: natural-language intent, bounded authority,
grounded answers, useful error handling, recoverable execution and reliable
judging demonstrations. These are engineering acceptance criteria, not a claim
of security certification, accessibility conformance or a contractual SLA.

| Gate | Required evidence | Starting checkpoint | Next acceptance action |
| --- | --- | --- | --- |
| P01 Product journey | Request, scope correction, exact consent, answer in requested supported language and actionable recovery | Real refiner/planner/task link checked; one transfer resource; funded delivery unverified | Compare former user flows and test corrections, provider failure and report-language behavior |
| P02 Ownership and authority | Owner isolation, exact financial scope, no model/memory signer authority, replay prevention | Automated negative paths and aggregate reservations; generated HTTP identity | Actual user Phantom acceptance and separately approved Devnet settlement/recovery |
| P03 Honest readiness | Process liveness separated from DB/ledger readiness and optional payment capability | `/api/health` returns200 even for unavailable dependencies | Dedicated probes, bounded shared checks, deploy gate and failure acceptance |
| P04 Safe shutdown | Stop new work, bounded HTTP drain, preserve uncertain payment facts and delayed bookkeeping | Close waits indefinitely for requests | SIGTERM/close race tests and restart recovery with the same proof |
| P05 Bounded public work | Expensive public verification/report calls limited before dependency work | Task/model limits exist; merchant verification not admitted through those limits | Global/same-proof admission, cancellation and replay stress tests |
| P06 Observability | Fixed request/route/status/latency records without payloads, credentials or private identifiers | Request IDs and owner audit exist; no complete operational measurements | Bounded structured logs, failure/abort counts and operator diagnostic procedure |
| P07 Recovery | Persisted conversation/task and uncertain payment facts survive restart | Persistent verified-TLS PostgreSQL and existing restart regressions | Rehearse a small restart/recovery demo with the original task/proof |
| P08 AI quality | Versioned KO/EN acceptance set, unsupported/outage handling, grounded answer contract | Six legacy synthetic cases and workspace regressions; one live happy-path request | Held-out scope/correction cases, report-language contract and bounded live acceptance budget |
| P09 Capacity | Bounded concurrency, dependency budgets and measured demo behavior | Four operations/process, two/owner; daily model-call limits | Repeatable low-load test and clear overload/cold-start behavior |
| P10 Safe releases | Reviewed exact SHA, required CI, actual image, rollback target and matching deployed source | Node254/Python177; CI5 including real image passed; manual deployment blueprint | Repeat release gates, negative startup and rollback rehearsal |
| P11 Accessibility | Keyboard/reading order, visible focus, readable amounts, labels, status and responsive use | Desktop/390px manual checks and native disclosures | Test complete critical journey at keyboard/zoom and track remaining WCAG2.2 criteria |
| P12 Demo delivery | Approved hosting/access, HTTPS origin, usable judge link and reproducible demo evidence | Render app grant pending; free-host blueprint; temporary restricted model key | Verify the approved demo origin, login/guards and warm/cold return before recording the supported journey |

## Demo boundaries

- The current network is Devnet. Authentication and a successful plan/quote do
  not prove a funded payment, delivery or a user's wallet-extension acceptance.
- A server-funded shared payer is a different trust/budget model from the earlier
  user-funded EVM TaskAccount. Old testnet evidence is not Solana acceptance.
- Free hosting is appropriate to the present demonstration scope. Measure and
  explain its cold-start behavior. Always-on availability, paid infrastructure
  and an off-site operational backup program are not acceptance gates here.
- The current restricted model credential was created for seven-day validation.
  Keep demo credentials valid for the agreed judging period without silently
  widening their grant. No key value belongs in this record or source control.
- Demo latency and failure recovery need measured evidence. Do not add uptime,
  RPO/RTO or enterprise-operations commitments to this hackathon objective.

## Current iteration evidence

The preceding PR11 passed full local Node289/Python206 checks. Its readiness/drain,
merchant replay admission, redacted diagnostics and scope-correction fixes have
independent review. Result-first KO/EN exports preserve exact facts and have
synthetic-render desktop/mobile acceptance. See [VERIFICATION.md](VERIFICATION.md)
for what each kind of evidence actually proves.

The original-prompt follow-up adds whole-interface KO/EN presentation, the
preserved team mark and explicit denial guidance. Its four versioned KO/EN
contract cases connect scope correction, reviewed plans, one Task and grounded
exports; actual-model quality is still unevaluated by these scripted cases.
Local follow-up checks pass288 non-PostgreSQL Node tests and209 Python tests.
Required PostgreSQL and image acceptance remain the exact PR's CI gates.

The design follow-up replaces repeated opening questions and empty management
panels with one purpose composer and three editable transfer-question starters.
The same linked Task stays above optional conversation history; completed
answers precede receipts, while review and recovery actions follow their current
status. [DESIGN.md](DESIGN.md) records the source-based acceptance criteria and
[VERIFICATION.md](VERIFICATION.md) distinguishes actual browser readback from
scripted financial display states.

Remaining product work includes explicit step URLs/browser history, voice
input, broader administrative audit presentation, actual-model
quality acceptance, model-bridge preflight/outage UX, approved public-demo
acceptance and separately approved wallet/funded Devnet completion. None is
closed by the above test counts.

## Improvement loop

1. Compare the earlier evidence and the last merged checkpoint, including lost
   capabilities, changed trust assumptions and actual usability failures.
2. Recheck relevant primary documentation and convert each gap into an observable
   acceptance result. Prioritize authority/data-loss/availability failures.
3. Assign exclusive files, implement bounded changes and exercise negative paths.
   Review source independently and retain exact command/runtime evidence.
4. Notify the user before push, run required CI on the exact head, merge through
   normal protections and verify the approved demonstration deployment.
5. Update this gate ledger with what was actually proven; unresolved gates keep
   the continuing quality goal active. Do not close it because one PR was merged.

## Primary references checked November 6

- [OWASP ASVS5.0.0](https://asvs.owasp.org/): verifiable security controls, with
  versioned requirement identifiers for a later explicit coverage mapping.
- [Google SRE launch checklist](https://sre.google/sre-book/launch-checklist/):
  capacity, dependencies, failure behavior, backup/restore, monitoring and releases.
- [Google SRE: implementing SLOs](https://sre.google/workbook/implementing-slos/):
  user-facing reliability objectives and a continuing measurement/review cycle.
- [WCAG2.2](https://www.w3.org/TR/WCAG22/): accessibility acceptance requirements.
- [Render health checks](https://render.com/docs/health-checks) and
  [free-service limits](https://render.com/docs/free): deployment readiness and
  the actual availability constraints of the selected host.
- [Supabase backups](https://supabase.com/docs/guides/platform/backups) and
  [PostgreSQL16 pg_dump](https://www.postgresql.org/docs/16/app-pgdump.html):
  consistent backup/restore, least privilege and client/server compatibility.
