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
