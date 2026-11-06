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

The table's starting checkpoint is historical, not a list of features still
absent. Released main `4e21fa1` includes the reviewed PR11–16 changes:

- P03–P06: dedicated DB/ledger readiness, bounded HTTP shutdown, merchant replay
  admission and redacted fixed-label diagnostics have implementation and
  negative-path regression evidence.
- P01/P08/P11: whole-interface KO/EN, scope correction, denial recovery,
  versioned scripted journey cases and purpose-led desktop/tablet/phone design
  are verified within the boundaries below. Voice, full keyboard/zoom coverage,
  actual-model quality and funded completion remain open.
- P10: [PR16's exact-source runtime CI](https://github.com/web5five/Floww_Solana_Server/actions/runs/42266339473)
  passed both required PostgreSQL/runtime/Python checks and an actual non-root,
  network-isolated image check. It did not deploy a public service.

The detailed acceptance record is [VERIFICATION.md](VERIFICATION.md). Those
implemented controls do not close public origin, wallet or payment acceptance.

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

The navigation follow-up adds explicit hash addresses and same-document
Back/Forward for all six pages, owned records and the four conversation stages.
Fresh authenticated reload restores the exact record through read-only calls.
Drafts, exact retry identities, current-owner state and keyboard focus have
dedicated race coverage and native-browser readback. No route authorizes a
financial operation or creates a replacement request.

Remaining product work includes the full voice-agent screen and chat microphone,
actual-model quality acceptance, approved public-demo
acceptance and separately approved wallet/funded Devnet completion. None is
closed by the above test counts.

The administrator follow-up implements a separate read-only operations console,
with joint-state payment/delivery attention, independent source freshness,
bounded HTTP charts and usable retained-record tables. Real PostgreSQL and
file-SQLite projections, authorization/resource races and native desktop/390px
KO/EN behavior have acceptance evidence in [VERIFICATION.md](VERIFICATION.md).
Its default administrator list remains empty; generated test identities do not
establish actual operator access. [ADMIN.md](ADMIN.md) defines the data and live
enablement boundary. [VOICE.md](VOICE.md) preserves the complete original voice
scope and its still-open microphone/provider acceptance.

The voice implementation profile uses bounded recorded transcription with the
current [file-transcription model](https://developers.openai.com/api/docs/guides/speech-to-text)
and verified-local device playback. [VOICE.md](VOICE.md) records the complete
two-surface contract and the remaining actual microphone/provider/audibility
gates. Local voice inventory is capability evidence, not completed speech.

The adapter follow-up adds one bounded, cached offline packaging check for the
configured Python workspace/report adapters. Known failure blocks new model
quota/message writes and new purchase work while preserving draft edits,
private reads and original-proof recovery. Unknown capability does not enable
new model/purchase actions. Local406 Node/209 Python checks, native KO/EN/390px
readback and actual healthy/bad-executable HTTP observations are recorded in
[VERIFICATION.md](VERIFICATION.md). The check invokes no model and does not claim
provider availability. Exact-source image CI and later public-demo acceptance
remain distinct release gates.

Browser-history acceptance in the navigation work covers same-document hash
Back/Forward and a fresh reload. Whole-document BFCache restoration across an
external logout/owner change still needs a dedicated lifecycle test; neither
`Cache-Control: no-store` nor the small DOM harness proves that boundary. No
live BFCache data leak has been demonstrated by the current audit.

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

## Primary references checked November 6–7

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
- [Node child-process lifecycle](https://nodejs.org/api/child_process.html#event-close):
  process exit and pipe closure are separate events; the packaging deadline
  must not wait indefinitely for inherited output pipes.
- [Python3.13 environment controls](https://docs.python.org/3.13/using/cmdline.html#envvar-PYTHONNOUSERSITE):
  disable user-site imports and bytecode writes while using the fixed adapter
  source path; do not inherit application credentials into the offline check.
- [Docker read-only containers](https://docs.docker.com/reference/cli/docker/container/run/#read-only):
  test the actual non-root image with a read-only root filesystem and external
  networking disabled, rather than infer image behavior from host imports.
