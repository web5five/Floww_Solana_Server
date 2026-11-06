# Optional model runtime for AI-02 and AI-03

`reference/ai_baseline/model_api.py` connects the existing callable model ports
to the OpenAI Responses REST API. Calling `select` can now request a structured
candidate decision from a configured model; `select_evidence` can request record
IDs after the workflow has released a protected response. This is an optional
provider profile, not the team's production-provider decision or a backend API.

No model or credential is selected automatically. Importing or constructing the
adapter makes no request and reads no environment variables or credential files.
The existing demos remain offline. This change has been tested against a local
HTTP server with scripted responses and dummy keys; no live model, paid API,
wallet, signature, settlement or provider-delivery test was performed.

## Connect the current ports

The integrating server supplies `chosen_model` and `server_api_key` from its own
approved configuration. Choose a model supporting this Structured Outputs
profile; no particular model, account access or output quality is established by
the local tests. Do not put credentials in source code, command arguments or
frontend bundles.

```python
from ai_baseline.model_api import OpenAIResponsesModel
from ai_baseline.workflow import consume, propose

model = OpenAIResponsesModel(
    model=chosen_model,
    api_key=server_api_key,
    timeout_seconds=15,
    max_request_bytes=96_000,
    max_response_bytes=32_000,
    max_output_tokens=1_024,
)

proposal_result = propose(context, discover_candidates, model.select, refresh_context)

# Later, after the authenticated backend supplies a bound observation:
if proposal_result.proposal is not None:
    result = consume(
        proposal_result.proposal,
        trusted_backend_outcome,
        read_authorized_resource,
        model.select_evidence,
        refresh_context,
    )
```

`consume` still checks policy, payment, fulfillment, proposal binding and current
scope before calling `read_authorized_resource` or the model. DENY, UNKNOWN,
pending delivery and failed delivery make neither call. The adapter does not
authenticate a `BackendOutcome`; its trusted mapping remains backend work.
Directly calling `select_evidence` bypasses that orchestration, so use it through
`consume` for protected data.

The selection request contains only purpose and candidate ID/description. It
does not serialize owner, task, mandate, recipient, resource, challenge or
credential fields. Prices and payment eligibility remain backend decisions;
this profile cannot independently rank financial terms omitted from its input.
The evidence request contains purpose and released record ID/text, without
source URLs or backend metadata. Callers must provide content authorized for the
configured model. Source references stay in the application and are reattached
to the exact selected records.

## Wire format and authority

Requests use a fixed `https://api.openai.com/v1/responses` endpoint, verified TLS,
`store: false`, `stream: false`, an empty tool list and an explicit output-token
cap. `store: false` is the API storage option; this code makes no broader data
retention claim. Instructions are separate from the user-content JSON. Schemas
use `text.format` with `type: json_schema` and `strict: true`, as described in the
[official Responses migration guide](https://developers.openai.com/api/docs/guides/migrate-to-responses?api-mode=responses).

The selection schema has an object root with one `decision` field. Its nested
`anyOf` permits PROPOSE, CLARIFY or STOP. Every object sets
`additionalProperties: false` and requires every declared field. Candidate and
record IDs are constrained to the supplied sets. The adapter unwraps `decision`
and passes it to the existing workflow parser; that parser independently rejects
unknown IDs, changed financial fields and added authority. The
[official Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
documents these schema restrictions and refusal/incomplete handling.

REST text is read from typed `output` message items and their `output_text`
content, with optional reasoning items ignored. A top-level SDK-style
`output_text` field alone is insufficient. The accepted envelope must be
completed, error-free and contain exactly one completed assistant message and
one text content item. Refusal, incomplete output, tool items, ambiguous output,
invalid JSON, duplicate keys and non-finite values stop processing. Structured
output does not establish factual accuracy, policy approval or payment proof.
AI-03 returns exact original excerpts with references, not model-authored facts.

## Runtime limits and errors

There is one POST per invocation, no redirect following, retry, environment-proxy
lookup or model-supplied URL. The default request-body cap is 96,000 UTF-8 bytes,
response-body cap 32,000 bytes and selected model-text cap 8,000 bytes. Configured
request/response caps must be positive integers no larger than 1,000,000. The
response is bounded both with and without Content-Length, and an overstated or
duplicate Content-Length is rejected. HTTP headers use Python's standard-library
parser limits; the configured byte cap applies to the body. Compressed responses
are rejected.

`timeout_seconds` is a per-socket inactivity limit, default 15 seconds and at
most 60 seconds. It is **not a total wall-clock deadline**. DNS resolution and
repeatedly arriving headers/body bytes can exceed it. This synchronous adapter
does not provide process cancellation; a production runtime needing a strict
total deadline must supply an outer isolation/cancellation boundary. It does
not resolve the other workflow callbacks' cancellation limits.

`ModelAPIError.code` exposes fixed codes such as `HTTP_ERROR`, `HTTP_REDIRECT`,
`NETWORK_TIMEOUT`, `RESPONSE_TOO_LARGE`, `MODEL_REFUSAL` and `MODEL_INCOMPLETE`.
Exceptions omit upstream bodies, raw exceptions and credentials, including
exception chains; the adapter repr omits its configuration. Within the existing
workflow, adapter failures become `SELECTION_UNAVAILABLE` or
`RESULT_MODEL_UNAVAILABLE` with no selected data released. No automatic retry or
new purchase follows an error.

## Local protocol checks

```sh
PYTHONPATH=reference python3 -m unittest discover -s reference/tests -p test_model_api.py -v
PYTHONPATH=reference python3 -m unittest discover -s reference/tests -v
```

The 23 adapter tests use `for_loopback_test(port=..., model=..., api_key=...)`, an
explicit test-only HTTP constructor restricted to `127.0.0.1` and
`/v1/responses`. Supply only dummy keys to it. Tests exercise actual HTTP request
and response parsing, all three decisions, selected excerpts, gate denial with
zero reads/requests, HTTP errors, redirects, refusal/incomplete/error envelopes,
malformed JSON, typed REST output, byte caps, truncated framing, header/body
inactivity, verified TLS configuration and credential/error redaction. Passing
them proves this local protocol behavior, not live model quality or end-to-end
Solana payment/delivery integration.

Actual local run on November 1, 2026: all 23 adapter tests passed (0.437 seconds),
then the full 112-test suite passed (0.443 seconds). `git diff --check` passed and
the four owned source/document filenames were read back and verified as NFC.
