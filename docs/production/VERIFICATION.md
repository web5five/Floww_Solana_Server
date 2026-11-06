# Workspace verification checkpoint — 2026-11-06

Initial local acceptance after the controller integrated the production workspace:

- Node runtime suite: **219 passed, zero failed/skipped**. This includes actual
  temporary TLS PostgreSQL connections and limited-role startup, both database
  adapters, HTTP Ed25519 wallet sign-in, concurrent reservations, crash/CAS
  regressions, stale-session privacy checks and browser-client behavior.
- Python suite: **166 passed**. Model tests use actual loopback HTTP with scripted
  Responses envelopes; their output is not external model-quality evidence.
- `npm run check`: 51 source/test/document files checked for JavaScript syntax,
  whitespace and actual NFC names. Workflow `actionlint` and Git whitespace
  checks passed. No additional dependencies were installed for this expansion.
- Separate actual managed-PostgreSQL startup succeeded with verified TLS and the
  dedicated runtime role. The public page/health returned 200; private workspace
  and task routes rejected unauthenticated requests. Financial readiness was
  false with payments off and no configured payer or merchant.
- In the internal browser, a genuinely signed, generated Ed25519 test identity
  exercised real model intent refinement and the separate planner/critic calls,
  exact plan-to-task linkage, persisted preference consent/store/remove,
  task archive/restore and logout clearing private DOM and form drafts.
- The first live refiner output had inconsistent status/missing-field metadata
  and was rejected. Prompt clarity and the explicit user-purpose draft were
  improved, then new explicit requests succeeded. Validators stayed strict;
  there were no hidden automatic model retries.
- The persisted successful plan identifies `live_model_planner_critic` and
  `gpt-5.4-mini`. Its single linked task remained `NOT_STARTED`; payment and
  delivery success were not fabricated. The browser test identity is separate
  from an actual user's Phantom-extension acceptance.
- Desktop and 390-pixel mobile layouts were visually inspected. Mobile overview,
  task, memory and activity flows remained within the viewport. The viewport
  override was reset and the generated session was logged out afterward.

The controller retained sanitized API readbacks and screenshots in the local
GWDC evidence directory, outside this repository. No credentials, session
cookies or payer material were added to source or evidence.

## Purpose-first UX acceptance

- Final Node suite: **254 passed, zero failed/skipped**, with required isolated
  PostgreSQL checks enabled. Of these, 39 browser-client behavior regressions
  execute the shipped scripts with a small DOM harness and scripted fetch;
  eight dedicated checks cover exact decimal/atomic conversions.
- Final Python suite: **177 passed**. Korean rolling-day expressions preserve
  frozen windows; unsupported compound/negated durations remain unresolved.
- Syntax, whitespace and NFC checks cover **56 integration files**.
  `actionlint` and `git diff --check` passed. No dependencies were added.
- Actual internal-browser acceptance used managed PostgreSQL and the configured
  restricted model. One typed request reached the refiner, automatic independent
  planner/critic and exact-plan confirmation, creating one linked persistent
  task in the same conversation. The model identifies `gpt-5.4-mini`.
- Reload preserved the same linked task and exact original millisecond scope.
  An unconfigured merchant stopped quote preparation; payment/delivery stayed
  `NOT_STARTED`, with no quote, approval or transaction. The generated signed
  test identity is separate from a user's Phantom-extension acceptance.
- Guest login failure preserved the draft. Desktop and 390px mobile screens
  were visually checked; long addresses wrap, optional progress opens, and
  logout removes private task/conversation content and form drafts. The
  temporary viewport was reset and the test session logged out.

See [EXPERIENCE.md](EXPERIENCE.md) for the product sources, interpretation and
preserved approval boundaries. Local screenshots and sanitized API readbacks
are outside this repo; live funded settlement is not part of these results.

## Hackathon-quality follow-up

The user clarified that production-level quality is the standard for a
hackathon entry. The [comparison](COMPARISON.md) and [quality ledger](READINESS.md)
record that scope and the exact earlier/current evidence boundaries.

- Final local Node suite: **289 passed, zero failed/skipped**, with required
  isolated PostgreSQL checks enabled. Python: **206 passed**. Source checks:
  **62 integration files**, plus `actionlint` and Git whitespace checks.
- Actual HTTP/SQLite and official-SDK loopback tests exercise ready/unready
  dependencies, timed-out probes, disconnects, bounded shutdown, delayed
  authentication/workspace work, final signing admission, original payment
  facts, and receipt persistence after forced HTTP closure.
- Merchant admission limits global active work and duplicate proof work per
  process. Claim/settlement ordering and same-proof recovery remain unchanged.
  This is not a claim of shared admission across multiple instances.
- Fixed-label operational records exclude private URLs, headers, bodies,
  wallets and proofs. Sink/clock failures do not change business outcomes.
  Destroyed responses are recorded incomplete, even when a delayed close event
  reports `writableFinished=true`.
- Unresolved explicit wallet/window corrections cannot silently reuse earlier
  scope. Presentation honors supported KO/EN and question focus without another
  model call, preserving every non-prose numeric/evidence/scope field.
- Result-first Korean/English HTML and Markdown exports were visually checked
  in the internal browser, including 390px mobile, expandable metadata and empty
  partial coverage. These render checks use clearly marked **synthetic fixtures**;
  they do not prove external-model quality, wallet use, settlement or delivery.
- The actual managed-PostgreSQL loopback preview returned `/livez`200,
  `/readyz`200 with DB+ledger ready, and private task/conversation401. Legacy
  capability health remains200 with payments disabled and financial readiness
  false. A configured model flag is not a live provider availability check.

Independent workers reviewed the merchant/lifecycle/telemetry integration and
the report/correction changes. Reviewed file hashes and sanitized readbacks
remain in the local GWDC evidence directory. The exact PR image result must be
read from CI; these host checks do not substitute for an image build.

A permanently hung handler deliberately retains its DB until its bookkeeping
finishes. The bounded HTTP-close result reports that incompleteness. No forced
DB-session termination or automatic release of uncertain `HELD` reservations
is introduced, and full startup resource-leak hardening is not claimed.

## Original-prompt product follow-up

The controller read the user's original submission-day messages, rather than
using only assistant recaps. [USER_INTENT.md](USER_INTENT.md) maps the relevant
KST times/source lines to current product acceptance and keeps still-open
step-navigation, guided-entry, voice and administrative requests visible.

- Final local non-PostgreSQL Node checks: **288 passed, zero failed/skipped**.
  The25 new UI contract/state cases are included. Python: **209 passed**.
  Syntax/whitespace/NFC checks cover67 integration files; `actionlint` and
  `git diff --check` passed. Low host disk space prevented running fresh local
  PostgreSQL clusters in this follow-up; those tests remain mandatory in CI.
- Interface locale changes update explicit authored text/attributes without
  navigation, rendering the whole view, submitting or fetching. Epoch guards
  prevent old-owner bindings from restoring private content. Drafts, exact
  amounts, consent, source text and report-download bytes are preserved.
- Actual approval403 denials trigger at most one guarded read of the same Task.
  Late old-owner200/401, selection changes, failed reads and a new sign-in are
  covered. An obsolete operation cannot clear a newer operation's busy state.
  DENY remains distinct from pending approval and confirmed payment.
- Two real loopback HTTP/auth/SQLite journeys exercise failure/replay/explicit
  retry, corrected-plan binding, one Task and actual approval-policy outcomes.
  They use a real keyless Python quote-proposal adapter and scripted model ports.
  ALLOW, budget refusal and recipient refusal all leave payment/delivery
  unstarted, with zero signer/redemption calls. These are not funded E2E runs.
- The versioned four-case KO/EN corpus is `contract_acceptance`, with
  `model_quality_evaluated=false`. Actual Python validators, critic gates,
  presentation and renderers preserve exact large amounts, references and
  partial-coverage limits. Unpaid integration consumption releases no answer.
- Internal-browser checks cover the actual unauthenticated managed-PostgreSQL
  preview plus separately scripted display cases. The latter check approval,
  same-Task chat denial and UNKNOWN recovery at desktop/390px; they do not prove
  real authentication or payment. One approval-language switch left requests
  at6 before/after and POSTs at0, preserving a9-decimal budget and checked consent.
- The team SVG is byte-identical to the original submitted Client asset. The
  local runtime serves it successfully with no third-party asset request.

Screenshots and sanitized readbacks remain outside the repository in the local
GWDC evidence directory. Exact release/CI source binding is recorded separately;
the checks above do not imply that a public deployment or Phantom transaction
has happened.

## Purpose-led design validation — 2026-11-07

The design criteria in [DESIGN.md](DESIGN.md) apply Michael's documented
authorization/accountability direction and the team's natural-conversation
discussion. The color and layout choices are the implementation, not a claim
that Michael specified a visual style.

- Local non-PostgreSQL Node suite: **300 passed, zero failed/skipped**. Its
  84 browser-client cases include12 design regressions for editable starters,
  pending-work fences, exact Task/component retention, optional transcripts,
  review/retry placement, language changes and logout. Python: **209 passed**.
- The internal browser inspected the shipped files at1280×720,768×1024 and
  390×844, including KO/EN entry, plan review, retry, exact approval, budget
  refusal, UNKNOWN and a result. A20-message conversation remained available
  without pushing the current Task or result behind the transcript.
- In the completed390×844 case, the answer paragraph starts at660px and ends
  at755px; both synthetic-data and partial-coverage notices remain visible.
  The completed status is60px tall. The same report precedes receipt details,
  while DENY and UNKNOWN retain their reason and safe next action.
- The native retry button is enabled and visible immediately after the stop
  notice, at539–585px on the phone. Its actual `<details>` ancestor is open.
  This checks real browser disclosure behavior, not just a DOM harness flag.
- A planned20-message conversation places the actual review at665px on the
  phone, ahead of revision input/history. Confirmation remains enabled after
  the scope facts; the check did not submit that action. Choosing an entry
  example focused the same local draft, and native Tab reached the primary
  action with a visible focus ring.
- All six management views remained reachable on the phone without horizontal
  clipping. Returning to the conversation retained one shared Task component.
  Reopening the transcript retained all20 messages; switching locale preserved
  its open state, exact9-decimal amount and source text.
- Scripted display cases are loopback-only, serve the actual web assets and
  reject state-changing requests. They prove presentation/interaction behavior,
  not user authentication, model quality, settlement or report delivery.
- Separately, the managed-PostgreSQL preview returned page200, `/livez`200,
  `/readyz`200 and unauthenticated `/api/tasks`401. Capability health was200
  with payments disabled and financial readiness false. No model or financial
  operation was requested during this design acceptance.

The temporary viewport override was reset, the guest draft cleared and the
actual local preview retained. Source syntax, NFC, workflow lint and Git
whitespace checks pass; no dependencies or remote account grants were added.

Source review, screenshot measurements and sanitized checks are retained in the
local GWDC evidence directory. Required PostgreSQL and deployment-image checks
remain CI gates for the exact PR head; these host checks do not replace them.

## Route restoration and current-context safety — 2026-11-07

- Full local Node suite: **361 passed, zero failed/skipped**, with required
  isolated PostgreSQL checks enabled. Python: **209 passed**. The 117 UI cases
  include 33 new navigation, replay, session and focus regressions. Source/NFC
  checks cover 70 files; workflow lint and Git whitespace checks pass.
- Six allowlisted page routes, UUID Task/conversation targets and four actual
  conversation-stage links support authenticated bootstrap, same-document
  Back/Forward and fresh reload. Traversal and paired browser events perform
  read-only hydration, without new model, quote, approval or execution calls.
- In the internal browser, the old page lost its selected conversation after
  reload. The new page restored its exact conversation and single linked Task.
  All six page routes and all four stage targets were inspected. Viewing an
  earlier stage preserved the factual completion status and current-step label.
- A direct result route for an UNKNOWN Task retained UNKNOWN, exposed no answer
  and showed a pending-stage explanation. A new draft's text, explicitly edited
  wallet/window and memory choice survived opening another conversation and
  returning with Back. The local navigation fixture recorded no non-GET calls.
- The narrow scope helpers preserve original millisecond facts unless edited.
  An uncertain explicit message retry reuses its original exact body and
  idempotency identifier after route restoration/fresh scope reads. A completed
  creation cannot redirect a newer route. Inert transports verify these races;
  they do not evaluate a live model or payment provider.
- Client owner/session generations and route/selection leases reject old
  responses, including old 401s, before they can affect the new context. Core
  handler tests cover same-wallet renewal and clearing a replacement owner's
  hidden private DOM. Their wallet/signature/HTTP ports are inert; this is not
  Phantom-extension acceptance.
- Native KO/EN desktop and 390px checks show full-width stage links, two phone
  columns and targets at least 44px tall. Stage focus no longer hides the exact
  price under the sticky header: the phone target starts at 96px below a 72px
  header; the desktop target starts at 104px below an 80px header. The focused
  stage anchor remained focused through a timed UNKNOWN-poll observation; a
  real core-poll regression separately checks unchanged anchor identity.
- The keyboard skip link preserves the current deep address. Actual local
  managed-PostgreSQL guest bootstrap sanitized the private target, hid the
  conversation/Task and displayed the login gate. No model or financial action
  was requested during native acceptance. The viewport was reset and an empty
  real local preview retained.

Authenticated financial states in the browser use an explicitly scripted,
loopback-only display service serving the unmodified web assets. They are not
funded settlement/delivery evidence. Screenshots, observed routes and release
binding remain in the local GWDC evidence directory. Whole-document BFCache
restoration is a separate unverified lifecycle boundary, as tracked in
[READINESS.md](READINESS.md).

## Cached adapter preflight and degraded experience — 2026-11-07

- Full local Node suite: **406 passed, zero failed/skipped**, with required
  isolated PostgreSQL checks enabled. Python: **209 passed**. The 24 new backend
  cases cover subprocess packaging and actual HTTP/SQLite integration; the UI
  set is now **138 cases**, including21 new capability/owner/route regressions.
  Source/NFC checks cover74 files; workflow lint and Git whitespace checks pass.
- Each default runtime starts one credential-free offline process to import
  the actual workspace and report modules independently and check their
  callable entry points. It does not invoke those functions. A two-second whole
  deadline, combined1KiB output limit, strict boolean protocol, cancellation and
  inherited-pipe cleanup have real subprocess acceptance. A counted executable
  runs once across repeated health/liveness/readiness and no-key planner calls.
- Immutable capability snapshots require exact own boolean fields. Production
  always checks packaging, even without a model key; only explicit programmatic
  injection identifies trusted test adapters. Direct application callers do not
  silently default to healthy capabilities. Public health fields remain local
  packaging facts; `modelConfigured` remains configuration, not provider health.
- Known workspace failure stops a new turn or plan before message/request
  mutation or model quota. Existing accepted request replay and private reads
  remain available. Workspace-only failure does not disable the independently
  usable manual Task/payment path. Known report failure blocks new quote,
  approval and signing before Task mutation or financial reservation.
- A previously UNKNOWN proof remains claimed, with its held budget and original
  reconciliation path. Recovery can persist confirmed settlement/delivery and
  spend observations without optional report processing. Tests preserve the
  original proof, prevent another signature and retain durable facts through
  logout while refusing result publication to the expired session. Financial
  and model ports in these HTTP/auth/SQLite cases are explicitly scripted.
- An actual missing-executable runtime serves the page, `/livez` and DB/ledger
  `/readyz` with200. Health returns both capabilities false and financial
  readiness false; private Task/conversation requests return401. This runtime
  uses SQLite and inert model configuration only. The actual local managed-DB
  preview separately returns both capabilities true, DB/ledger readiness200
  and private401s, with payments disabled. Neither check calls a model provider.
- Native desktop/390px KO/EN readback preserves an editable guest draft across
  language changes and same-document Back, displays a useful unavailable
  explanation and keeps explicit login accessible. Unknown/malformed readiness
  disables new model/purchase work. Saved reports, original reconciliation and
  recovery, exact consent values and stale-owner/route fences have regressions.
- A separate read-only display fixture shows confirmed payment/delivery without
  an answer. Journey, Task guidance and result area explain the processing stop
  and keep original recovery available. Loading that stored Task now announces
  its current state instead of claiming the work completed. Its recorded17 GET
  requests and zero non-GET requests are display evidence, not real identity,
  settlement or delivery. Screenshots and HTTP records remain local. Temporary
  fixture tabs/processes were closed; the empty actual preview was retained.

The container gate now runs the actual non-root image with a read-only root
filesystem, a bounded temporary filesystem and external networking disabled. It
asserts both capabilities through default startup instead of running a second
independent import probe. Its passing result must still be read from exact-source
CI; no local host test is described as container acceptance.

## Read-only administrator console — 2026-11-07

The controller reread original source77127 and inspected existing telemetry and
persisted records before generating the dashboard reference. The implementation
uses the shipped team mark and puts payment/delivery attention before graphs and
logs. [ADMIN.md](ADMIN.md) defines the projections, authority and data limits;
[VOICE.md](VOICE.md) separately preserves the complete voice requirement.

- Final full Node suite: **486 passed, zero failed/skipped**, with required
  isolated PostgreSQL checks enabled. Python: **209 passed** earlier in this
  iteration; its source is unchanged. The final browser-client set has192
  cases, including54 administrator checks. Syntax/whitespace/NFC checks cover86
  files; workflow lint and Git whitespace checks pass. The last table-only CSS
  alignment change passed static checks and native readback after this suite;
  it changed no JavaScript or data behavior.
- The backend's109-case subset includes28 real owned-PostgreSQL checks. Actual
  READ ONLY transactions,750ms statement cancellation,200ms lock timeout,
  savepoint partial-source recovery, single-flight cleanup and unsafe counters
  were exercised. Actual file-SQLite checks cover BigInt counts, immutable
  persisted bytes/revisions, file identity, a held lock and worker exit after
  timeout. No managed database session was killed and no schema was changed.
- Generated Ed25519 operator/ordinary identities exercised actual HTTP wallet
  authentication and read-only file-SQLite projections. Seven controlled Tasks
  produced7 stored/1 unresolved/1 confirmed-undelivered/1 delivered-without-report.
  All four administrator GETs returned200; ordinary access/overview returned403
  and guests401. Private sentinels and full Task IDs were absent from the DTOs.
  No external model, RPC, signing or redemption port was called. These controlled
  financial states are not actual settlement or delivery evidence.
- Native1280×720 and390×844 KO/EN readback covered source timestamps, partial
  failure, refresh, event/current-state captions and text/table alternatives.
  An unavailable request source retained healthy Task metrics and valid role;
  an unavailable Task source displayed unconfirmed dashes. Ordinary/guest gates
  cleared data, and return/Back preserved the consumer draft and same Task.
  Switching language left observed API calls at51 before/after, with zero POSTs.
- Native acceptance found and fixed stale translated shared headings after
  authentication, enlarged chart swatches and over-tall mobile log rows. Final
  desktop metrics end at637px within a720px first viewport. Legend swatches are
  9×10px. The390px log has47px rows, a bounded internal scroll region, five
  semantic column headers, native keyboard horizontal/vertical scrolling and
  sticky headers. Full36-character correlation IDs fit at the right edge;
  page width remains375/375px. The temporary viewport and fixture tab were reset
  and closed. These visual checks do not claim complete WCAG conformance.
- The actual managed-PostgreSQL loopback preview was gracefully drained and
  restarted on the candidate source. Page/liveness/readiness returned200,
  readiness was true, both local adapter capabilities were true, and private
  Task/administrator routes returned401. Payments remain disabled and the
  administrator allowlist remains empty. This proves neither live operator
  activation, actual Phantom acceptance nor model-provider availability.

Independent review covered the frozen backend/UI hashes and final native
screenshots. The generated concept, exact prompt/provenance, sanitized HTTP and
browser observations and final images are retained outside Git in the local
GWDC evidence directory. Actual operator access still needs a user-designated
address and real wallet acceptance; no generated identity is promoted to that
role. Exact head, required CI and merge binding are recorded with the release.

## Complete voice implementation and engineering acceptance — 2026-11-07

The controller reread the September30 original voice-screen and functional
chat-microphone requests before selecting the profile in [VOICE.md](VOICE.md).
Both surfaces share the existing conversation, draft and authority path. The
full view offers an explicitly disclosed one-turn input→new answer→local
playback cycle; the compact chat microphone remains review-first.

- Final full Node suite: **585 passed, zero failed/skipped**, including required
  isolated PostgreSQL checks. Independent final browser-client review/tests:
  **264 passed, zero failed/skipped**. Syntax/whitespace/NFC checks cover101
  files; workflow lint and Git whitespace checks pass. Python source is
  unchanged from the earlier209-case pass and remains a required CI check.
- The frozen backend's116-case targeted set and31 owned-PostgreSQL cases cover
  byte-derived canonical WAV bounds, raw authentication before allocation,
  durable atomic call/second quotas, actual provider-interface dispatch,
  owner/revision/session fences, cancellation, drain and hung-work admission.
  The independent24-case voice subset also passes. No managed DB schema,
  existing restricted text credential or financial authority was changed.
- Native IAB acceptance used a generated signed identity, actual HTTP and owned
  file-SQLite, a real48kHz oscillator MediaStream, the shipped AudioWorklet and
  native OfflineAudioContext resampling to16kHz. STT and text-model ports were
  scripted. They do not establish actual microphone recognition or model quality.
  With only the private fixture's wall stop extended to65s, the actual unchanged
  processor sealed at60,000ms and1,920,044 canonical WAV bytes. HTTP returned200
  into an editable transcript without automatically sending it.
- Native KO/EN one-turn Start/Stop flows reached a new reply through the same
  ordinary conversation path, with no intermediate Send or Speak click. The
  selected local유나 andDaniel voices produced actual native `onstart`; KO also
  reached `onend`, and EN after a scripted10s transcription delay accepted
  explicit Stop and displayed stopped state. Queued synthesis alone was not
  counted. Human audibility and real-provider performance remain unverified.
- Cancel during delayed transcription cleared the UI and propagated through
  actual HTTP transport to the scripted provider's abort signal. No cancelled
  capture invoked refinement. Compact input appended to the exact existing
  draft through explicit Use, closed the shared panel and did not send. A
  controlled linked synthetic/partial Task projected its exact report over the
  earlier plan, showed source/transfer caveats and allowed explicit local read.
  Its stored payment/delivery markers are not settlement evidence.
- Native acceptance found and fixed a new-conversation language reset, false
  pending-request notice, stale playback status and mobile editor placement.
  At390×844 the final editor occupies508–649px and Send692–738px; page width is
  375/375px. The answer precedes optional recording/playback settings. Logout
  removed private drafts, replies and transcript even from hidden DOM. The
  viewport was reset and the temporary fixture tab closed. Across this final
  QA process:6 scripted STT admissions,1 aborted,2 scripted refinements and
  **zero external-provider or financial-port calls**.

Final source hashes, sanitized HTTP/native observations, intermediate findings
and desktop/mobile screenshots are retained outside Git in the local GWDC
voice evidence directory. The complete voice acceptance gate stays open for a
separately authorized Audio credential, real microphone input, actual STT and
human-audible KO/EN replies. The code and default image keep voice off until
explicitly configured. Actual image/CI evidence belongs to the exact PR head.

## Browser-session lifecycle and conditional logout — 2026-11-07

[SESSION_LIFECYCLE.md](SESSION_LIFECYCLE.md) defines the departure/return contract
and its distinction between cold form restoration and a cached document.

- A native baseline using PR17's pinned web assets, generated signed A/B
  identities, actual HTTP and owned file-SQLite reproduced A's unsent text
  under B after whole-document Back. Production `no-store` headers were
  preserved. The new document ID and `persisted=false` prove this was cold
  form-history restoration, not a native BFCache observation. No text was sent
  and no real user's data, model or financial port was used.
- The final behavior passed **613 full Node checks, zero failed/skipped**, with
  required owned PostgreSQL enabled. Independent complete UI acceptance passed
  **285 checks** across11 suites. The21 lifecycle checks exercise pending
  approval→execution and message→planning fences, session-read/owner races,
  exact retry identities, acknowledgment resets and media cleanup through the
  shipped scripts with controlled ports. They do not stand for real Phantom,
  provider or device acceptance.
- Seven actual HTTP/Ed25519/file-SQLite checks cover conditional captured-token
  revocation, guest/mismatch no-op204, strict input/origin guards, authority-read
  failure and delayed lookup/deletion racing a new B sign-in. Every conditional
  response omits `Set-Cookie`; manual `{}` logout still clears the cookie.
- Frozen behavior-source native acceptance now discards A's old form under B,
  refetches the same owner's stored conversation at its original address and
  clears private DOM/fields/opaque targets after session revocation. Cold
  unbound unsent text is discarded; same-document owner-bound draft quarantine
  is a separately tested path. A scripted3s session-read delay left the layout
  hidden and old content absent from all DOM, including input values, until
  verified reads completed. No model/financial operation or automatic write
  occurred in the final native process.
- Final390×844 readback measured390/390px content with no overflow on the
  neutral gate. The heading was then shortened in KO/EN for first-entry accuracy
  and phone readability. That final copy-only adjustment passed46 focused
  locale/lifecycle checks and a new native390px readback; all other behavioral
  source hashes stayed unchanged from the613-case run. Actual image/CI checks
  still belong to the final exact PR head. The viewport was reset and temporary
  fixture tabs were closed.

Native Back recreated documents even in a separate explicitly cache-eligible
engineering fixture. Actual `pageshow.persisted=true` remains unexercised in the
available browser; scripted events and `no-store` do not close that native
evidence gate. No production header, schema, credential or signing grant was
weakened. Before/after images, source hashes, sanitized observations and exact
release/CI binding are retained outside Git in the local GWDC evidence directory.

## Required external gates

The runtime workflow tests the actual Node 24 deployment image as a non-root
user, imports the deployed Python adapters, then checks its HTTP workspace,
private-route 401s and disabled payment guards with external networking off.
Its result belongs to the exact PR source and must be read from CI; local host
checks do not count as a built-container result.

Render is still a separately authorized deployment step. The blueprint targets
`main`, the free plan and manual deployment, with automatic deploys off. The
repository-app installation permission and final public origin are not implied
by a successful local build. External funded Devnet settlement/delivery and
Phantom user acceptance remain separate from the tests listed above.
# Actual-model baseline and output contract — November7

The first pre-sample-frozen live12-case/32-stage set ran40 actual Responses calls
against main `34a28b1` / `workspace/v1`. All returned, without retry, port failure
or omitted stages. Automated checks passed7/12 cases and22/32 stages; the sample
failed product acceptance. Independent agent review inspected32 stages/40 role
returns and retained `humanReviewed=false`. Exact scope matched all22 refinement
stages, but count/direction/language presentation, Korean supported recovery and
a critic authority false positive still failed. Fixed English coverage copy and
model-generated English prose were attributed separately.

The controller preserved the original sample before source changes. The new
version2 corpus keeps the same cases, rubric and expected labels and explicitly
labels this a `post-baseline-regression`. [AI_QUALITY.md](AI_QUALITY.md) records
the source/suite binding, usage calculation, safe live-run boundary and the
remaining semantic acceptance work.

The output-contract implementation passed local Node618/618 with zero skips and
required owned PostgreSQL, plus Python242/242. These include actual signed
HTTP/file-SQLite owner checks for valid/invalid/omitted interface language and
exact retry identity; UI retry across a language change; actual Node-to-Python
subprocess-to-loopback Responses propagation; and actual Python stdin/stdout
tests for priority and negation without external credentials. They prove local
integration, not actual-provider language/refusal improvement or payment.
