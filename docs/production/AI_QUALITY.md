# Conversational output quality

The supported journey must retain the latest goal, exact wallet and UTC window,
requested language, and count/incoming/outgoing presentation through refinement,
planning and the final deterministic report. Model approval is advisory. Neither
memory, a model response nor an output preference grants financial authority.

## First actual-model sample

On November7 the controller ran the pre-sample-frozen `workspace-live-acceptance/v1`
set against source `34a28b19bbd6c9f129e7255de82ca0b22e068b97` and
`workspace/v1`, using the actual `gpt-5.4-mini` Responses transport. The frozen
suite hash was
`1000fdca31768a038645e48f9d775e24c5556a66d244d952189ab1d461602295`.

- All12 cases/32 stages were evaluated, with40 actual role returns, no port,
  artifact, call-limit or guard-only replacement, and no retry. The whole run
  took79.401seconds; the longest individual POST took4.287seconds.
- The automated result was7/12 cases and22/32 stages. Independent agent review
  inspected every stage and all40 returned role DTOs. `humanReviewed=false`.
  These are observations on this small authored set, not general accuracy.
- Usage receipts contained42,965 input tokens and6,810 output tokens. Charging
  every input token at the published uncached standard rate gives a conservative
  calculation of$0.06286875. This is not invoice reconciliation.
  [The model pricing](https://developers.openai.com/api/docs/models/gpt-5.4-mini)
  was checked before the run; the request explicitly selected the standard tier.
- The private controller record retains the original results, allowlisted role
  DTOs, usage/reservation ledger, hard-supervisor outcome and independent review.
  Original sample files were made read-only before the implementation changed.
  No credential, raw HTTP envelope or response header was stored there.

The sample failed acceptance. Count-only intent could become a full summary;
an English-to-Korean incoming-only correction could lose its presentation in the
stored purpose; Korean plans could be English; and fixed English coverage copy
was appended separately. A supported Korean correction was still refused, and
one valid English reporting plan was falsely rejected for explaining that human
approval was required and no execution had occurred. Exact wallet/start/end
checks matched in all22 refinement stages; that does not erase these failures.

## Output contract

The message endpoint accepts optional `interfaceLanguage` with only `ko` or
`en`. It is validated before message persistence and model-quota admission,
bound into the exact request hash, and stored in the owner-scoped conversation
JSON. Omitted legacy inputs retain their existing hash/body behavior. Refinement
and planning receive the stored fallback. An uncertain browser retry keeps its
original language, body and request ID even if the screen language changes.

Python derives a finite internal `outputContract` from genuine user turns and
the prior purpose, with the interface language as fallback. Explicit latest
user choices override older choices. Assistant text, memory and catalog prose
cannot replace that contract. Negation of wallet/period changes is distinguished
from negation of a language or an `only` preference. Ambiguous presentation
retains a full summary rather than inventing a narrow filter.

All three model roles receive the contract in the context digest. After the
refiner's existing shape, status, scope and content checks, one finite natural
output sentence is attached to a non-null purpose. An earlier exact authored
sentence is replaced, not accumulated. The goal is not truncated, a null goal is
not invented, and `UNSUPPORTED` is never promoted by this post-processing.
The existing report formatter can recover this choice from the actual validated
purpose. No intent DTO, financial approval or database schema was expanded.

The fixed partial-coverage limitation is selected in the requested language and
deduplicated. Unknown model qualifications remain verbatim. `assistantText`,
plan summary and step reasons are still model outputs: natural wording,
language compliance, faithful recovery and accurate critic explanations need
actual samples and semantic review. A canonical suffix or critic `ACCEPT`
cannot prove them.

The current `workspace/v5` refiner follows a short ordered contract: current
goal, exact user-derived scope anchors, then status. Its internal intent contains
exactly five nullable fields. The schema fixes wallet/start/end to those anchors, including
null when unresolved. The validator rejects clearing a known anchor, inventing
an unknown one and asking for clarification when
the scope is already valid and complete. It never changes such a response into
`READY_TO_PLAN`. A submillisecond interval fails closed rather than being silently
truncated into a different scope.

The adapter owns the external `missingFields` array: it derives the list solely
from the validated five values that are null. The public/stored six-field intent
DTO is unchanged. A raw refiner `missingFields` property is forbidden, even if
its value would be correct; it is never corrected or silently discarded. Empty
raw strings are rejected rather than treated as new nulls. This removes a
redundant model task; it is not evidence that the model learned to enumerate
missing fields. Raw five-field role output and the derived external DTO stay
separate in acceptance records.

`currentUserMessage` repeats the exact latest normalized user text, excluding a
trailing assistant reply. `temporalScope` is computed only from the explicit
anchors and supplied UTC clock. Unknown bounds produce null comparisons; known
bounds get date-order, non-future and maximum-window facts. Those facts are part
of the context digest and cannot be supplied by the caller, memory or model.
They do not classify the goal, fill another missing field or authorize a plan.

The critic distinguishes an unsupported capability claim from a statement that
the capability is unavailable, and an authority grant from a requirement for
later human approval. Existing scope, registered-resource, secret, URL and
authority guards remain in force. No automatic retry or bypass of a rejecting
critic is introduced. New output suffixes describe presentation only; they do
not turn an unsupported balance question into a transfer task. Stored version2
suffixes remain readable and are replaced idempotently on a new refinement.

## Retained version2 failure

The version2 sample at source `250b74e292488df0841a3047f85274f98ddaa6ae`
returned34 core roles plus4 interface-language probe roles. Core acceptance
remained7/12 cases, with29 evaluated and3 guard-only stages. The two separate
interface probes passed. All38 actual POSTs had usage receipts; the conservative
usage calculation was$0.06479775. No failed output was retried or replaced.

Independent agent review found contradictory Korean completion, lost Korean
corrections, inconsistent missing fields and an English critic false rejection.
Natural Korean plan wording and interface-language handling improved in the
observed calls. One plan followed a non-ready refiner result only because the
old evaluator invoked the component independently. That is component evidence,
not product workflow success. The original sample and review are retained.

## Repeatable acceptance

The retained version3 sample at source
`11092a09390267fdf56e2559fc38e67236c63cab` improved the automated result to
10/12 cases and29/32 stages. It returned38 core roles, evaluated31 stages and
correctly blocked one plan after a failed refinement. The separate two
interface-language probes passed with4 role calls. All42 POSTs had usage
receipts; the conservative calculation was$0.06861075. The run took82.793seconds,
without retries, provider uncertainty or artifact failure.

Two Korean defects remained in that sample: a valid past interval was called
future, and a supported transfer-only correction inherited an earlier unsupported refusal.
The sample failed acceptance and was preserved before further changes.

The version4 sample at source `92e20b1b9699af77f5a011f90f8d36b5acc24dc0`
returned all40 core roles and4 interface-probe roles. Automated acceptance was
11/12 cases and31/32 stages, with both probes passing and no blocked, guard-only
or transport-failure stage. All44 POSTs had receipts; the conservative cost was
$0.07873350 over85.623seconds. The earlier time/recovery defects were not observed,
but one Korean clarification omitted the null time fields from its model-written
missing list. Independent review also found two assistant-language mismatches
despite correct final presentation options. This sample failed acceptance and
is retained unchanged; version5's derived list does not reclassify it as success.

The source corpus is
[`workspace-live-acceptance-v5.json`](../../reference/evaluations/workspace-live-acceptance-v5.json).
Its original cases, rubric, expected labels, fixture facts and role denominators
are unchanged. Its split is explicitly `post-baseline-regression`; the same
examples are no longer an unseen acceptance set. The result also states that
validated purpose may include the production's deterministic user-output binding.
Raw model DTOs are retained separately, so a product option match must not be
reported as an improvement in raw model language quality.

The version3 evaluator advances an automatic plan only after an actual validated
`READY_TO_PLAN` result. A non-ready/invalid refinement produces a failed
`WORKFLOW_BLOCKED` plan stage with no provider call. All12 cases/32 stages stay
in the denominator; a later independent case or real correction can still run.
This gate uses observed state, never an expected answer or repaired model DTO.

From a source checkout:

```sh
FLOWW_REQUIRE_POSTGRES_TESTS=true npm test
PYTHONDONTWRITEBYTECODE=1 npm run test:ai
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=reference python3 -m ai_baseline.workspace_acceptance
```

The last command prints inventory only. The evaluator reads no key or provider
environment and has no default live client. A live caller must inject the real
model and own durable per-POST reservations, strict usage parsing, independent
wall-clock supervision, parent-cancellation cleanup and a fixed total budget.
Inactivity timeouts alone are insufficient. Uncertain requests retain their
reservation and stop later work; killed work is not silently restarted.

Eight planned stages generate actual plans plus critics; two other stages use
deliberately stale plan fixtures with actual critics. They stay separate. The
formatter check uses exact synthetic facts: it is not a paid report, actual
transfer retrieval, model arithmetic, payment, microphone or public deployment
acceptance. Actual-person review remains distinct from controller/agent review,
consistent with [OpenAI's evaluation guidance](https://developers.openai.com/api/docs/guides/evaluation-best-practices).

## Version5 actual result

The sample at source `d4a35ab8b24c524318816dfb894a5c2d5dec143d` completed all
12 cases/32 stages with40 actual core role returns. All12 cases/32 stages passed
the automated criteria; no stage was skipped, guarded or workflow-blocked. Two
separate interface-language probes passed with4 more actual role returns. The
core includes8 generated plans plus critics and2 explicitly fixture-based
negative critic probes, not10 generated plans.

All44 POSTs had strict standard-tier usage receipts, with no retry or uncertain
request. The run took81.039seconds. Its conservative usage calculation was
$0.07977600. Together with the historical$0.45 reserve and all four earlier
samples, the cumulative conservative total is$0.80478675 within the existing$1
validation authorization. This is not invoice reconciliation. Each run has its
own immutable results and budget ledger; an earlier failure is never replaced.

Independent agent semantic review inspected all32 stages, both probes and44
raw role returns. It found no additional P1/P2 or actionable finding in this
sample; the earlier assistant-language failures were not observed.
`humanReviewed=false`. Local checks pass618 Node tests
with required isolated PostgreSQL and274 Python tests. Independent source review
passed118 targeted checks, and the supervised caller passed18 offline checks.
Actual-provider behavior, semantic review and exact-source CI are separate gates.
A passing small authored regression set is not a general model accuracy claim,
actual-person review, funded Devnet payment, microphone or public deployment proof.
