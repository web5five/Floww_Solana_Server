# Purpose and evidence evaluation

The evaluation runner checks whether a selector follows the task purpose and
chooses the expected evidence IDs. It runs the existing `workflow.propose` and
`workflow.consume` validators with a bounded synthetic dataset. Both model ports
are supplied by the caller; the runner selects no provider or production model.

The six cases cover a relevant resource, an unrelated catalog, an ambiguous
request, merchant prompt injection, record prompt injection and invented
references. Their expected actions, candidate IDs and evidence IDs are explicit
test labels in
[`purpose-and-evidence-v1.json`](../../reference/evaluations/purpose-and-evidence-v1.json).
They are narrow synthetic scenarios, not a representative model-quality benchmark.

## Run with supplied model ports

From the repository root, set `PYTHONPATH=reference`. An integration can pass any
two callables implementing the existing `SelectionModel` and `EvidenceModel`
ports, including a separately configured HTTP adapter:

```python
import json
from dataclasses import asdict
from ai_baseline.evaluation import load_suite, run_evaluation

# select(instruction, purpose, candidates) -> JSON string
# select_evidence(instruction, purpose, records) -> JSON string
# Obtain both configured callables from your caller; no adapter is imported here.
def evaluate_configured_ports(select, select_evidence):
    report = run_evaluation(
        load_suite(), select, select_evidence, execution_kind="caller_supplied"
    )
    return json.dumps(asdict(report), indent=2)
```

Use `execution_kind="scripted"` for scripted callables. This label is a caller
declaration, not an attestation that an adapter contacted a live service.
`load_suite(path)` accepts an explicit local dataset path; `parse_suite(text)` is
available for in-memory inputs. Expected answers are never passed to either model.

## Read the scores

Each case has separate `selection` and `evidence` scores:

| Field | Meaning |
| --- | --- |
| `structural_valid: true` | The existing workflow accepted the response shape and supplied references. |
| `structural_valid: false` | The workflow rejected the model output. |
| `structural_valid: null` | No accepted/rejected response was available, or the stage was skipped. Read its fixed `code`. |
| `expectation_match` | Selection action/candidate or the exact set of evidence IDs matches the dataset label. `null` means evidence was not required. |
| `passed` | Selection matches and, for a proposal case, evidence also matches. |

Selecting an existing but unrelated candidate is structurally valid and fails the
purpose expectation. Selecting existing irrelevant records is also structurally
valid and fails the evidence expectation. Invented IDs fail structural validation.
Evidence order is ignored; missing or extra IDs fail the exact-set comparison.
When selection does not match, the runner skips protected-resource consumption.
STOP and CLARIFY cases need no evidence call. Aggregate counts preserve these
distinctions; a structurally accepted response alone never counts as a passed case.

The report contains case IDs/categories, public expected/observed IDs, fixed
workflow statuses/codes and counters. It omits purpose text, resource bodies,
model rationales, clarification questions, exceptions and raw provider responses.
Do not place credentials in fixture labels or IDs. An injected adapter remains
responsible for its own secret-safe logging, request limits and cancellation.

The runner allows 1–32 cases, up to 20 candidates and 50 resource records per case,
and a 256,000-byte dataset. Existing workflow body/model limits also apply. A fixed
UTC clock makes fixture expiries reproducible. Each selection and eligible
evidence call happens once, sequentially, with no retries. Port exceptions become
fixed workflow failure codes; the synchronous runner cannot interrupt a hung port.

Backend authorization/payment/delivery inputs are always `synthetic_fixture`.
Even when a real model adapter is injected, scores describe these synthetic cases
only. They do not verify authentic settlement, merchant truth, Devnet, production
authorization, UI integration or end-to-end purchasing. The wallet analytics
adapter's deterministic arithmetic has separate tests; this suite evaluates the
generic model selection/evidence ports rather than numeric analytics calculation.

## Verify the runner

```sh
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=reference python3 -m unittest discover -s reference/tests -p 'test_evaluation.py' -v
PYTHONDONTWRITEBYTECODE=1 PYTHONPATH=reference python3 -m unittest discover -s reference/tests -v
```

These tests inject scripted callables and exercise scoring, workflow rejection,
exceptions, bounded inputs and report redaction. Their passing results are
synthetic/scripted implementation evidence, not measured live-model quality.
