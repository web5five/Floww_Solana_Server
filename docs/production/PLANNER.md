# Bounded workspace model roles

`service/planner.mjs` exports `createPlanner({python,model,apiKey,timeoutMs})`
with asynchronous `refine(input, {signal?})` and `plan(input, {signal?})` ports.
The controller owns authenticated persistence, current revisions, plan hashes,
approval and execution. This adapter has no payment, database or signing port.

Input has exactly `messages`, `intent`, `memories`, `catalog`, `nowIso`.
`intent:null` and individual null scope fields are accepted. Intent fields are
`purpose,wallet,windowStart,windowEnd,resourceId,missingFields`. Memory input is
the controller's owner-filtered, unexpired explicit `{key,value}` preferences.
Reserved financial or execution-policy memory keys are rejected. Other catalog
configuration, including payee, amount, URL and credentials, is not forwarded.

Only registered ID and capability `wallet-transfers` are accepted. The model
sees bounded observed transfer coverage, never an exhaustive indexer, balances,
profit or identity claims. A plan step is exactly
`{role:'planner',capability:'wallet-transfers',resourceId:'wallet-transfers',reason}`.
Resource steps cannot repeat. The current one-resource catalog therefore yields
one step; no simulated choice between invented providers is presented.

## Model execution

Refinement makes one real model call. Planning makes a planner call followed
by a separate critic call using the same explicitly configured model and
existing `OpenAIResponsesModel` transport. An ACCEPT with no issue codes is
required. This is role separation, not independent evidence of model quality.
There is no automatic retry, tool execution or model-configured destination.
The original AI validators and transport are unchanged.

The existing Responses transport provides strict JSON Schema, fixed official
HTTPS destination, certificate verification, `store:false`, `stream:false`,
no tools, bounded request/response sizes and scrubbed diagnostics. The new
layer validates every model response again. A server-computed context digest
binds it to the exact bounded inputs; the digest is not financial authority.

Latest explicit wallet and UTC timestamp corrections override older history.
English `last/past N hours/days` and Korean `지난/최근 N 시간/일/일주일` use the
supplied server UTC clock. An already resolved relative interval stays frozen
during planning or a later style-only turn. Unsupported or ambiguous calendar
expressions require clarification; missing scope is never invented from memory.
The controller still must recheck current owner/session/revision after awaits.

## Bounds and result contract

| Boundary | Limit |
| --- | --- |
| Input / output | 64,000 / 16,000 UTF-8 bytes |
| History | 1–12 messages, 2,000 characters each |
| Preferences | 0–5, key 64/value 512 characters |
| Plan / model roles | At most 3 unique resource steps, 2 calls per plan |
| Model output tokens | 1,200 per call; at most 2,400 per plan |
| Model HTTP | 64,000 request / 24,000 response bytes, no retries |
| Parallel child processes | 2 per Node process; excess returns WORKSPACE_BUSY |
| Total process time | Default 25 seconds; configured 1–120,000 ms |

Refine returns `status:READY_TO_PLAN|CLARIFICATION_REQUIRED|UNSUPPORTED`,
`assistantText,intent,executionKind,modelVersion,promptVersion`.
Plan returns `status:PROPOSED`, `summary,steps,limitations` plus the same metadata.
`executionKind` is `live_model_intent_refinement` or `live_model_planner_critic`.
`modelVersion` is the configured model identifier, not an independently resolved
provider version. `promptVersion` is `workspace/v1`.

Failures are fixed `{status:'STOPPED',code}` objects. Missing configuration is
`MODEL_NOT_CONFIGURED`; it cannot return successful inference. Other codes cover
invalid input/output, stale context, missing scope/resource, critic rejection,
unavailable model, total timeout, cancellation, process failure, byte limits and
concurrency. No input, key, provider body or exception chain is returned.

## Verification

`node --test test/planner.test.mjs` verifies real Python processes, a local HTTP
Responses exchange through the original transport, cancellation, hard process
termination, concurrency, byte limits and credential redaction. Python tests in
`reference/tests/test_workspace_cli.py` cover null scope, latest corrections,
frozen relative windows, model/critic rejection, injection, stale bindings,
unknown resources, financial-memory isolation and HTTP format.

These use scripted model outputs, temporary executables and loopback HTTP with
dummy keys. They do not establish live-model answer quality or payment success.
The controller alone performs actual configured-model and managed-DB checks.
