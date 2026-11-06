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

## Version2 output contract

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

The `workspace/v2` prompts distinguish a newly supported goal from unsupported
words quoted or replaced in earlier turns. They distinguish an actual authority
request from a no-execution/human-approval boundary. Existing schema, explicit
scope, registered-resource, secret, URL and authority guards remain in force.
No automatic retry or bypass of a rejecting critic is introduced.

## Repeatable acceptance

The source corpus is
[`workspace-live-acceptance-v2.json`](../../reference/evaluations/workspace-live-acceptance-v2.json).
Its original cases, rubric, expected labels, fixture facts and role denominators
are unchanged. Its split is explicitly `post-baseline-regression`; the same
examples are no longer an unseen acceptance set. The result also states that
validated purpose may include the production's deterministic user-output binding.
Raw model DTOs are retained separately, so a product option match must not be
reported as an improvement in raw model language quality.

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

The first version2 live regression and separate interface-language integration
probes are pending. Current local checks pass618 Node tests with required owned
PostgreSQL and242 Python tests. The actual-provider and exact-source CI release
gates must be recorded separately after execution.
